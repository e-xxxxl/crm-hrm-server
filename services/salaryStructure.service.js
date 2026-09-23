import { SalaryStructure } from "../models/hrm/SalaryStructure.js";
import { Employee } from "../models/hrm/Employee.js";
import { AppError } from "../utils/AppError.js";

export async function getCurrent(orgId, employeeId) {
  return SalaryStructure.findOne({ organizationId: orgId, employee: employeeId, isCurrent: true });
}

export async function history(orgId, employeeId) {
  await assertEmployee(orgId, employeeId);
  return SalaryStructure.find({ organizationId: orgId, employee: employeeId }).sort({ effectiveFrom: -1 });
}

async function assertEmployee(orgId, employeeId) {
  const e = await Employee.findOne({ _id: employeeId, organizationId: orgId });
  if (!e) throw AppError.notFound("Employee not found");
  return e;
}

/**
 * Replace an employee's salary structure. The previous current structure is
 * closed (isCurrent=false, effectiveTo) and a new one created, so pay history
 * is preserved. Also stamps the employee's salaryHistory + salaryStructure ref.
 */
export async function setStructure(orgId, employeeId, input, actorUserId) {
  const employee = await assertEmployee(orgId, employeeId);
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();

  const current = await getCurrent(orgId, employeeId);
  if (current) {
    current.isCurrent = false;
    current.effectiveTo = effectiveFrom;
    await current.save();
  }

  const structure = await SalaryStructure.create({
    organizationId: orgId,
    employee: employeeId,
    currency: input.currency || "NGN",
    effectiveFrom,
    isCurrent: true,
    basic: input.basic || 0,
    housing: input.housing || 0,
    transport: input.transport || 0,
    subsidy: input.subsidy || 0,
    dataAllowance: input.dataAllowance || 0,
    exGratia: input.exGratia || 0,
    referralBonus: input.referralBonus || 0,
    customEarnings: input.customEarnings || [],
    grossMonthly: input.grossMonthly || 0,
    commissionPerTrip: input.commissionPerTrip || 0,
    payeApplicable: input.payeApplicable ?? true,
    pensionApplicable: input.pensionApplicable ?? true,
    nhfApplicable: input.nhfApplicable ?? false,
    reason: input.reason,
    createdBy: actorUserId,
  });

  const gross =
    structure.grossMonthly ||
    structure.basic + structure.housing + structure.transport + structure.subsidy + structure.dataAllowance +
      structure.exGratia + structure.referralBonus +
      (structure.customEarnings || []).reduce((s, c) => s + (c.amount || 0), 0);

  employee.salaryStructure = structure._id;
  employee.salaryHistory = employee.salaryHistory || [];
  const open = employee.salaryHistory.find((h) => !h.to);
  if (open) open.to = effectiveFrom;
  employee.salaryHistory.push({ from: effectiveFrom, gross, reason: input.reason, changedBy: actorUserId });
  await employee.save();

  return structure;
}

export default { getCurrent, history, setStructure };
