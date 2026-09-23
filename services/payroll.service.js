import mongoose from "mongoose";
import { PayrollRun } from "../models/hrm/PayrollRun.js";
import { Payslip } from "../models/hrm/Payslip.js";
import { SalaryStructure } from "../models/hrm/SalaryStructure.js";
import { TripLog } from "../models/hrm/TripLog.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { LeaveType } from "../models/hrm/LeaveType.js";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, paginated } from "../utils/query.js";
import { monthDayKeys, dayKeyToDate, zonedWeekday, eachDayKey } from "../utils/datetime.js";
import { calculatePayslip } from "./payroll.engine.js";
import { roundMoney } from "../utils/payroll/tax.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function loadOrg(orgId) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.badRequest("Unknown organization");
  return org;
}

/* ------------------------------- runs -------------------------------- */

export async function listRuns(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.year) filter.year = Number(query.year);
  const [items, total] = await Promise.all([
    PayrollRun.find(filter).sort({ year: -1, month: -1 }).skip(skip).limit(limit),
    PayrollRun.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getRun(orgId, id, { withPayslips = true } = {}) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (!withPayslips) return { run };
  const payslips = await Payslip.find({ organizationId: orgId, payrollRun: id })
    .populate("employee", "firstName lastName employeeId")
    .sort({ "employeeSnapshot.name": 1 });
  return { run, payslips };
}

export async function createRun(orgId, { year, month, payDate, notes }, actor) {
  const org = await loadOrg(orgId);
  const existing = await PayrollRun.findOne({ organizationId: orgId, year, month });
  if (existing) {
    throw AppError.conflict(`A payroll run for ${MONTHS[month - 1]} ${year} already exists (${existing.reference})`);
  }
  const reference = await nextCode("PR", `${orgId}:payrollrun`, 4);
  return PayrollRun.create({
    organizationId: orgId,
    reference,
    strategy: org.payrollStrategy,
    year,
    month,
    periodLabel: `${MONTHS[month - 1]} ${year}`,
    payDate: payDate ? new Date(payDate) : org.settings?.payDayOfMonth
      ? new Date(year, month - 1, Math.min(org.settings.payDayOfMonth, 28))
      : undefined,
    notes,
    status: "draft",
    createdBy: actor.userId,
  });
}

/**
 * Compute (or recompute) every payslip in the run. Idempotent while the run is
 * draft/calculated — existing payslips are replaced.
 */
export async function calculateRun(orgId, id, actor, { excludeEmployees = [] } = {}) {
  const org = await loadOrg(orgId);
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (!["draft", "calculated"].includes(run.status)) {
    throw AppError.badRequest(`Cannot recalculate a run that is ${run.status}`);
  }

  const tz = org.settings?.timezone || "Africa/Lagos";
  const workweek = org.settings?.workweek || [1, 2, 3, 4, 5];
  const monthKey = `${run.year}-${String(run.month).padStart(2, "0")}`;
  const keys = monthDayKeys(monthKey);
  const workingDaysInMonth = keys.filter((k) =>
    workweek.includes(zonedWeekday(dayKeyToDate(k, tz), tz)),
  ).length;

  const excludeSet = new Set(excludeEmployees.map(String));
  const monthStart = new Date(run.year, run.month - 1, 1);
  const monthEnd = new Date(run.year, run.month, 0, 23, 59, 59);

  const employees = await Employee.find({ organizationId: orgId, status: "active" })
    .populate("department", "name")
    .populate("branch", "name");

  const structures = await SalaryStructure.find({
    organizationId: orgId,
    isCurrent: true,
    employee: { $in: employees.map((e) => e._id) },
  });
  const structureByEmp = new Map(structures.map((s) => [String(s.employee), s]));

  // Unpaid leave days per employee this month.
  const unpaidType = await LeaveType.find({ organizationId: orgId, category: "unpaid" }).select("_id");
  const unpaidTypeIds = unpaidType.map((t) => String(t._id));
  const approvedLeave = await LeaveRequest.find({
    organizationId: orgId,
    status: "Approved",
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  }).select("employee leaveType startDate endDate");
  const unpaidDaysByEmp = new Map();
  for (const lr of approvedLeave) {
    if (!unpaidTypeIds.includes(String(lr.leaveType))) continue;
    const days = eachDayKey(lr.startDate, lr.endDate, tz).filter(
      (k) => k >= keys[0] && k <= keys[keys.length - 1] &&
        workweek.includes(zonedWeekday(dayKeyToDate(k, tz), tz)),
    ).length;
    unpaidDaysByEmp.set(String(lr.employee), (unpaidDaysByEmp.get(String(lr.employee)) || 0) + days);
  }

  // Trip counts (hybrid).
  let tripsByEmp = new Map();
  if (org.payrollStrategy === "hybrid") {
    const trips = await TripLog.aggregate([
      {
        $match: {
          organizationId: oid(orgId),
          countsForPayroll: true,
          payrollRun: null,
          dayKey: { $gte: keys[0], $lte: keys[keys.length - 1] },
        },
      },
      {
        $group: {
          _id: "$employee",
          count: { $sum: 1 },
          overrideTotal: { $sum: { $ifNull: ["$amountOverride", 0] } },
          overrideCount: { $sum: { $cond: [{ $ifNull: ["$amountOverride", false] }, 1, 0] } },
        },
      },
    ]);
    tripsByEmp = new Map(trips.map((t) => [String(t._id), t]));
  }

  await Payslip.deleteMany({ organizationId: orgId, payrollRun: id });

  const totals = {
    grossEarnings: 0, commission: 0, paye: 0, payeEmployer: 0, pensionEmployee: 0, pensionEmployer: 0,
    nhf: 0, otherDeductions: 0, totalDeductions: 0, netPay: 0, employeeCount: 0,
  };
  const docs = [];
  let excluded = 0;

  for (const emp of employees) {
    if (excludeSet.has(String(emp._id))) {
      excluded += 1;
      continue;
    }
    const structure = structureByEmp.get(String(emp._id));
    if (!structure) {
      excluded += 1;
      continue;
    }

    const tripAgg = tripsByEmp.get(String(emp._id));
    const tripCount = tripAgg?.count || 0;
    // Mix flat-rate trips with per-trip overrides.
    const tripAmountTotal = tripAgg
      ? tripAgg.overrideTotal + (tripAgg.count - tripAgg.overrideCount) * (structure.commissionPerTrip || 0)
      : null;

    const calc = calculatePayslip({
      strategy: org.payrollStrategy,
      structure,
      tripCount,
      tripAmountTotal: org.payrollStrategy === "hybrid" ? tripAmountTotal : null,
      unpaidLeaveDays: unpaidDaysByEmp.get(String(emp._id)) || 0,
      workingDaysInMonth,
    });

    docs.push({
      organizationId: orgId,
      payrollRun: id,
      employee: emp._id,
      year: run.year,
      month: run.month,
      periodLabel: run.periodLabel,
      currency: structure.currency || "NGN",
      strategy: org.payrollStrategy,
      employeeSnapshot: {
        name: emp.fullName,
        employeeId: emp.employeeId,
        position: emp.position,
        department: emp.department?.name,
        branch: emp.branch?.name,
        taxState: emp.taxState,
        pfaName: emp.pension?.pfaName,
        bank: {
          bankName: emp.bank?.bankName,
          accountNumber: emp.bank?.accountNumber,
          accountName: emp.bank?.accountName,
        },
      },
      earnings: calc.earnings,
      grossEarnings: calc.grossEarnings,
      tripCount: calc.tripCount,
      commission: calc.commission,
      deductions: calc.deductions,
      paye: calc.paye,
      payeEmployer: calc.payeEmployer,
      pensionEmployee: calc.pensionEmployee,
      pensionEmployer: calc.pensionEmployer,
      nhf: calc.nhf,
      totalDeductions: calc.totalDeductions,
      netPay: calc.netPay,
      taxDetail: calc.taxDetail,
      status: "pending",
    });

    totals.grossEarnings += calc.grossEarnings;
    totals.commission += calc.commission;
    totals.paye += calc.paye;
    totals.payeEmployer += calc.payeEmployer;
    totals.pensionEmployee += calc.pensionEmployee;
    totals.pensionEmployer += calc.pensionEmployer;
    totals.nhf += calc.nhf;
    totals.totalDeductions += calc.totalDeductions;
    totals.netPay += calc.netPay;
    totals.employeeCount += 1;
  }

  if (docs.length) await Payslip.insertMany(docs);

  for (const k of Object.keys(totals)) totals[k] = roundMoney(totals[k]);
  run.totals = totals;
  run.excludedEmployeeCount = excluded;
  run.status = "calculated";
  run.calculatedAt = new Date();
  await run.save();

  return getRun(orgId, id);
}

export async function approveRun(orgId, id, actor) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status !== "calculated") throw AppError.badRequest(`Run must be calculated first (currently ${run.status})`);
  if (run.totals.employeeCount === 0) throw AppError.badRequest("Nothing to approve — the run has no payslips");
  run.status = "approved";
  run.approvedBy = actor.userId;
  run.approvedAt = new Date();
  await run.save();
  return run;
}

export async function finalizeRun(orgId, id, actor) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status !== "approved") throw AppError.badRequest(`Run must be approved first (currently ${run.status})`);

  run.status = "finalized";
  run.finalizedBy = actor.userId;
  run.finalizedAt = new Date();
  await run.save();

  // Attach consumed trip logs so they aren't paid twice.
  if (run.strategy === "hybrid") {
    const monthKey = `${run.year}-${String(run.month).padStart(2, "0")}`;
    const keys = monthDayKeys(monthKey);
    await TripLog.updateMany(
      { organizationId: orgId, payrollRun: null, dayKey: { $gte: keys[0], $lte: keys[keys.length - 1] } },
      { $set: { payrollRun: id } },
    );
  }
  return run;
}

export async function cancelRun(orgId, id) {
  const run = await PayrollRun.findOne({ _id: id, organizationId: orgId });
  if (!run) throw AppError.notFound("Payroll run not found");
  if (run.status === "finalized") throw AppError.badRequest("A finalized run cannot be cancelled");
  run.status = "cancelled";
  await run.save();
  await Payslip.deleteMany({ organizationId: orgId, payrollRun: id });
  return run;
}

/* ------------------------------ payslips ----------------------------- */

export async function listPayslips(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { organizationId: orgId };
  if (query.payrollRun) filter.payrollRun = query.payrollRun;
  if (query.employee) filter.employee = query.employee;
  if (query.status) filter.status = query.status;
  if (query.year) filter.year = Number(query.year);
  if (query.month) filter.month = Number(query.month);

  const [items, total] = await Promise.all([
    Payslip.find(filter)
      .sort({ year: -1, month: -1, "employeeSnapshot.name": 1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName employeeId"),
    Payslip.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getPayslip(orgId, id) {
  const slip = await Payslip.findOne({ _id: id, organizationId: orgId }).populate(
    "payrollRun",
    "reference status periodLabel payDate",
  );
  if (!slip) throw AppError.notFound("Payslip not found");
  return slip;
}

export async function employeePayslips(orgId, employeeId) {
  return Payslip.find({ organizationId: orgId, employee: employeeId })
    .sort({ year: -1, month: -1 })
    .populate("payrollRun", "reference status");
}

export async function markPayslipPaid(orgId, id) {
  const slip = await Payslip.findOne({ _id: id, organizationId: orgId }).populate("payrollRun", "status");
  if (!slip) throw AppError.notFound("Payslip not found");
  if (slip.payrollRun?.status !== "finalized") {
    throw AppError.badRequest("The payroll run must be finalized before marking payslips paid");
  }
  slip.status = "paid";
  slip.paidAt = new Date();
  await slip.save();
  return slip;
}

/** Bank-upload CSV for a finalized (or approved) run. */
export async function bankExportCsv(orgId, runId) {
  const { run, payslips } = await getRun(orgId, runId);
  if (!["approved", "finalized"].includes(run.status)) {
    throw AppError.badRequest("Export is available once the run is approved");
  }
  const header = ["Account Number", "Account Name", "Bank", "Amount", "Narration", "Employee ID"];
  const rows = payslips.map((p) => [
    p.employeeSnapshot?.bank?.accountNumber || "",
    csv(p.employeeSnapshot?.bank?.accountName || p.employeeSnapshot?.name || ""),
    csv(p.employeeSnapshot?.bank?.bankName || ""),
    p.netPay.toFixed(2),
    csv(`Salary ${run.periodLabel}`),
    p.employeeSnapshot?.employeeId || "",
  ]);
  return [header, ...rows].map((r) => r.join(",")).join("\r\n");
}

function csv(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default {
  listRuns,
  getRun,
  createRun,
  calculateRun,
  approveRun,
  finalizeRun,
  cancelRun,
  listPayslips,
  getPayslip,
  employeePayslips,
  markPayslipPaid,
  bankExportCsv,
};
