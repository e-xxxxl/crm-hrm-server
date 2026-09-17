import { LeaveType } from "../models/hrm/LeaveType.js";
import { LeaveRequest } from "../models/hrm/LeaveRequest.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex } from "../utils/query.js";

/** Sensible starting set, created on demand when an org has none. */
export const DEFAULT_LEAVE_TYPES = [
  { name: "Annual Leave", code: "ANNUAL", category: "annual", paid: true, defaultDaysPerYear: 20, accrual: "annual", carryOverMaxDays: 5, minNoticeDays: 3 },
  { name: "Casual Leave", code: "CASUAL", category: "casual", paid: true, defaultDaysPerYear: 7, accrual: "annual", minNoticeDays: 1 },
  { name: "Maternity Leave", code: "MATERNITY", category: "maternity", paid: true, defaultDaysPerYear: 112, accrual: "none", genderEligibility: "Female", includeWeekends: true, requiresDocument: true, minNoticeDays: 30 },
];

export async function ensureDefaults(orgId) {
  const count = await LeaveType.countDocuments({ organizationId: orgId });
  if (count > 0) return;
  await LeaveType.insertMany(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, organizationId: orgId })));
}

export async function listLeaveTypes(orgId, query = {}) {
  await ensureDefaults(orgId);
  const filter = { organizationId: orgId };
  if (query.active === "true") filter.active = true;
  if (query.active === "false") filter.active = false;
  if (query.category) filter.category = query.category;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { code: rx }];
  }
  return LeaveType.find(filter).sort({ name: 1 });
}

export async function getLeaveType(orgId, id) {
  const t = await LeaveType.findOne({ _id: id, organizationId: orgId });
  if (!t) throw AppError.notFound("Leave type not found");
  return t;
}

export async function createLeaveType(orgId, input) {
  const dup = await LeaveType.findOne({
    organizationId: orgId,
    $or: [{ code: input.code?.toUpperCase() }, { name: input.name }],
  });
  if (dup) throw AppError.conflict("A leave type with that name or code already exists");
  return LeaveType.create({ ...input, organizationId: orgId });
}

export async function updateLeaveType(orgId, id, input) {
  const t = await LeaveType.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: input },
    { new: true, runValidators: true },
  );
  if (!t) throw AppError.notFound("Leave type not found");
  return t;
}

export async function setLeaveTypeActive(orgId, id, active) {
  if (!active) {
    const open = await LeaveRequest.countDocuments({
      organizationId: orgId,
      leaveType: id,
      status: { $in: ["Pending", "Manager Approved", "Clarification Requested"] },
    });
    if (open > 0) {
      throw AppError.badRequest(`Cannot deactivate — ${open} open request(s) use this leave type`);
    }
  }
  const t = await LeaveType.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { $set: { active } },
    { new: true },
  );
  if (!t) throw AppError.notFound("Leave type not found");
  return t;
}

export default {
  ensureDefaults,
  listLeaveTypes,
  getLeaveType,
  createLeaveType,
  updateLeaveType,
  setLeaveTypeActive,
  DEFAULT_LEAVE_TYPES,
};
