import crypto from "node:crypto";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { Department } from "../models/hrm/Department.js";
import { Branch } from "../models/hrm/Branch.js";
import { User } from "../models/hrm/User.js";
import { Rider } from "../models/crm/Rider.js";
import { nextCode } from "../models/hrm/Counter.js";
import { nextCode as nextCrmCode } from "../models/crm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { ROLES, hasPermission } from "../utils/permissions.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";

/**
 * The HRM "Employees" screen and the CRM "Riders" screen are two separate
 * ways to end up with a login that has the Rider role — creating the login
 * here (rather than through CRM → Riders → provision login) never created
 * the matching Rider document, so the PWA's `selfRider()` lookup found
 * nothing and the rider saw "your login is not linked to a rider profile".
 * Called whenever an employee is granted (or switched to) the Rider role, so
 * both paths land in the same place: an existing unlinked Rider for this
 * phone gets linked, otherwise a minimal one is created.
 */
async function ensureRiderProfile(orgId, employee, user) {
  const already = await Rider.findOne({ tenantId: orgId, user: user._id });
  if (already) return already;

  const unlinked = employee.phone ? await Rider.findOne({ tenantId: orgId, phone: employee.phone, user: null }) : null;
  if (unlinked) {
    unlinked.user = user._id;
    unlinked.employee = employee._id;
    await unlinked.save();
    return unlinked;
  }

  const riderCode = await nextCrmCode("RID", `${orgId}:rider`, 4);
  return Rider.create({
    tenantId: orgId,
    riderCode,
    name: employee.fullName,
    phone: employee.phone,
    email: employee.email,
    user: user._id,
    employee: employee._id,
    vehicleType: "bike",
    status: "active",
  });
}

const SORTABLE = ["lastName", "firstName", "employeeId", "position", "dateJoined", "createdAt", "employmentStatus"];

/** Fields a caller without `employee:read_sensitive` must never receive. */
const SENSITIVE_SELECT = "+nin +bvn +salaryHistory";

export async function listEmployees(orgId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { lastName: 1, firstName: 1 });

  const filter = { organizationId: orgId };
  if (query.status) filter.status = query.status;
  if (query.employmentStatus) filter.employmentStatus = query.employmentStatus;
  if (query.employmentType) filter.employmentType = query.employmentType;
  if (query.department) filter.department = query.department;
  if (query.branch) filter.branch = query.branch;
  if (query.joinedFrom || query.joinedTo) {
    filter.dateJoined = {};
    if (query.joinedFrom) filter.dateJoined.$gte = new Date(query.joinedFrom);
    if (query.joinedTo) filter.dateJoined.$lte = new Date(query.joinedTo);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { middleName: rx },
      { email: rx },
      { employeeId: rx },
      { position: rx },
      { phone: rx },
    ];
  }

  const [items, total] = await Promise.all([
    Employee.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("department", "name")
      .populate("branch", "name")
      .populate("reportingManager", "firstName lastName employeeId"),
    Employee.countDocuments(filter),
  ]);

  return paginated(items, total, { page, limit });
}

export async function getEmployee(orgId, id, { includeSensitive = false } = {}) {
  let q = Employee.findOne({ _id: id, organizationId: orgId })
    .populate("department", "name")
    .populate("branch", "name state geofenceRadiusMeters")
    .populate("reportingManager", "firstName lastName employeeId position")
    .populate("user", "email status lastLoginAt");
  if (includeSensitive) q = q.select(SENSITIVE_SELECT);
  const employee = await q;
  if (!employee) throw AppError.notFound("Employee not found");
  return employee;
}

async function assertRefsBelongToOrg(orgId, input) {
  if (input.department) {
    const ok = await Department.exists({ _id: input.department, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown department for this organization");
  }
  if (input.branch) {
    const ok = await Branch.exists({ _id: input.branch, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown branch for this organization");
  }
  if (input.reportingManager) {
    const ok = await Employee.exists({ _id: input.reportingManager, organizationId: orgId });
    if (!ok) throw AppError.badRequest("Unknown reporting manager for this organization");
  }
}

export async function createEmployee(orgId, input, actorUserId, actorPermissions = []) {
  const org = await Organization.findById(orgId);
  if (!org) throw AppError.badRequest("Unknown organization");

  const { provisionLogin, ...data } = input;
  input = data;

  const emailTaken = await Employee.findOne({ organizationId: orgId, email: input.email.toLowerCase() });
  if (emailTaken) throw AppError.conflict("An employee with that email already exists");

  await assertRefsBelongToOrg(orgId, input);

  const employeeId =
    input.employeeId?.trim().toUpperCase() ||
    (await nextCode(org.code, `${orgId}:employee`, 4));

  const now = new Date();
  const joined = input.dateJoined ? new Date(input.dateJoined) : now;

  const employee = new Employee({
    ...input,
    email: input.email.toLowerCase(),
    organizationId: orgId,
    employeeId,
    dateJoined: joined,
    positionHistory: [{ from: joined, title: input.position, grade: input.grade, changedBy: actorUserId }],
    departmentHistory: input.department
      ? [{ from: joined, department: input.department, changedBy: actorUserId }]
      : [],
    branchHistory: input.branch ? [{ from: joined, branch: input.branch, changedBy: actorUserId }] : [],
  });
  await employee.save();

  // Auto-link an existing platform user that already belongs to this org.
  const existingUser = await User.findOne({ email: employee.email });
  if (existingUser && existingUser.membershipFor(orgId)) {
    await linkUser(orgId, employee, existingUser);
  }

  let login = null;
  if (provisionLogin && !employee.user) {
    const result = await provisionEmployeeLogin(orgId, employee, provisionLogin, actorPermissions);
    login = result.tempPassword ? { tempPassword: result.tempPassword } : { created: true };
  }

  return { employee, login };
}

/**
 * Give an employee a platform login. Granting the Super Admin role itself
 * requires the caller to already hold it (`actorPermissions` carries the
 * wildcard `*`) — otherwise any role with plain `employee:write` could mint
 * itself an admin.
 *
 * An employee's login is scoped to the organization that created them — if
 * the email already belongs to a user with an active membership in a
 * *different* org, this refuses rather than silently merging the two into
 * one cross-org login (that would let one employee clock in/access data in
 * an org they were never hired into). Genuine multi-org accounts (Super
 * Admin, Group Admin) are provisioned deliberately through the admin
 * registration flow (`auth.service.js#registerUser`), not through this
 * per-employee "Create login" action.
 */
export async function provisionEmployeeLogin(orgId, employee, { role, password } = {}, actorPermissions = []) {
  if (!ROLES.includes(role)) throw AppError.badRequest(`Unknown role "${role}"`);
  if (role === "Super Admin" && !hasPermission(actorPermissions, "*")) {
    throw AppError.forbidden("Only a Super Admin can grant the Super Admin role");
  }

  let user = await User.findOne({ email: employee.email }).select("+passwordHash");
  const tempPassword = password || crypto.randomBytes(9).toString("base64url");

  if (!user) {
    user = new User({
      name: employee.fullName,
      email: employee.email,
      phone: employee.phone,
      memberships: [{ organization: orgId, role, status: "active", employee: employee._id, isPrimary: true }],
    });
    await user.setPassword(tempPassword);
    user.mustChangePassword = true;
    await user.save();
  } else if (!user.membershipFor(orgId)) {
    const otherOrgMembership = (user.memberships || []).find(
      (m) => m.status === "active" && String(m.organization) !== String(orgId),
    );
    if (otherOrgMembership) {
      throw AppError.conflict(
        `${employee.email} already has a login in another organization. Each employee's login is scoped to one organization — use a different email for this employee, or if they genuinely work across organizations, have a Super Admin add this org to their existing account instead of creating a new login here.`,
      );
    }
    user.memberships.push({ organization: orgId, role, status: "active", employee: employee._id });
    await user.save();
  } else {
    const m = user.membershipFor(orgId);
    m.employee = employee._id;
    await user.save();
  }

  employee.user = user._id;
  await employee.save();
  if (role === "Rider") await ensureRiderProfile(orgId, employee, user);
  return { user, tempPassword: user.mustChangePassword ? tempPassword : null };
}

/** View an employee's login details for this org — email, role, status, last sign-in. */
export async function getEmployeeLogin(orgId, employee) {
  if (!employee.user) return null;
  const user = await User.findById(employee.user);
  if (!user) return null;
  const membership = user.membershipFor(orgId);
  if (!membership) return null;
  return {
    userId: user._id,
    email: user.email,
    role: membership.role,
    status: membership.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Change an employee's login email, role, or suspended/active status for this
 * org. Reuses the same Super-Admin-only guard as granting the role at
 * provisioning time. Changing the login email checks it isn't already taken
 * by a different account.
 */
export async function updateEmployeeLogin(orgId, employee, input, actorPermissions = []) {
  if (!employee.user) throw AppError.badRequest("This employee has no platform login yet");
  const user = await User.findById(employee.user);
  if (!user) throw AppError.badRequest("This employee has no platform login yet");
  const membership = user.membershipFor(orgId);
  if (!membership) throw AppError.badRequest("This employee has no platform login yet");

  if (input.role && input.role !== membership.role) {
    if (!ROLES.includes(input.role)) throw AppError.badRequest(`Unknown role "${input.role}"`);
    if (input.role === "Super Admin" && !hasPermission(actorPermissions, "*")) {
      throw AppError.forbidden("Only a Super Admin can grant the Super Admin role");
    }
    membership.role = input.role;
  }
  if (input.status && input.status !== membership.status) {
    membership.status = input.status;
  }
  if (input.email && input.email.toLowerCase() !== user.email) {
    const taken = await User.findOne({ email: input.email.toLowerCase(), _id: { $ne: user._id } });
    if (taken) throw AppError.conflict("That email is already in use by another account");
    user.email = input.email.toLowerCase();
  }

  await user.save();
  if (membership.role === "Rider") await ensureRiderProfile(orgId, employee, user);
  return getEmployeeLogin(orgId, employee);
}

/** Reset an employee's login password — sets a new temp password they must change on next sign-in, and revokes their existing sessions for this org. */
export async function resetEmployeeLoginPassword(orgId, employee, password) {
  if (!employee.user) throw AppError.badRequest("This employee has no platform login yet");
  const user = await User.findById(employee.user).select("+passwordHash +sessions");
  if (!user) throw AppError.badRequest("This employee has no platform login yet");
  if (!user.membershipFor(orgId)) throw AppError.badRequest("This employee has no platform login yet");

  const tempPassword = password || crypto.randomBytes(9).toString("base64url");
  await user.setPassword(tempPassword);
  user.mustChangePassword = true;
  user.sessions = (user.sessions || []).filter((s) => String(s.organization) !== String(orgId));
  await user.save();
  return { tempPassword };
}

async function linkUser(orgId, employee, user) {
  const membership = user.membershipFor(orgId);
  if (membership && !membership.employee) {
    membership.employee = employee._id;
    await user.save();
  }
  if (!employee.user) {
    employee.user = user._id;
    await employee.save();
  }
}

export async function updateEmployee(orgId, id, input, actorUserId) {
  if (input.provisionLogin) delete input.provisionLogin;
  const employee = await Employee.findOne({ _id: id, organizationId: orgId }).select(SENSITIVE_SELECT);
  if (!employee) throw AppError.notFound("Employee not found");

  await assertRefsBelongToOrg(orgId, input);

  if (input.employeeId) {
    const nextId = input.employeeId.trim().toUpperCase();
    if (nextId !== employee.employeeId) {
      const taken = await Employee.findOne({ organizationId: orgId, employeeId: nextId, _id: { $ne: employee._id } });
      if (taken) throw AppError.conflict(`Employee ID "${nextId}" is already in use`);
      employee.employeeId = nextId;
    }
  }

  const now = new Date();

  // Track position / department / branch transitions in the history arrays.
  if (input.position && input.position !== employee.position) {
    closeOpen(employee.positionHistory, now);
    employee.positionHistory.push({ from: now, title: input.position, grade: input.grade ?? employee.grade, changedBy: actorUserId });
  }
  if (input.department && String(input.department) !== String(employee.department || "")) {
    closeOpen(employee.departmentHistory, now);
    employee.departmentHistory.push({ from: now, department: input.department, changedBy: actorUserId });
  }
  if (input.branch && String(input.branch) !== String(employee.branch || "")) {
    closeOpen(employee.branchHistory, now);
    employee.branchHistory.push({ from: now, branch: input.branch, changedBy: actorUserId });
  }

  const PROTECTED = ["organizationId", "employeeId", "_id", "status", "positionHistory", "departmentHistory", "branchHistory", "salaryHistory"];
  for (const [key, value] of Object.entries(input)) {
    if (PROTECTED.includes(key)) continue;
    employee.set(key, value);
  }
  if (input.email) employee.email = input.email.toLowerCase();

  await employee.save();
  return employee;
}

export async function setEmployeeStatus(orgId, id, status, reason, actorUserId) {
  const employee = await Employee.findOne({ _id: id, organizationId: orgId });
  if (!employee) throw AppError.notFound("Employee not found");

  employee.status = status;
  if (status === "inactive") {
    employee.deactivatedAt = new Date();
    employee.deactivatedReason = reason || "";
    if (employee.employmentStatus !== "Exited") employee.employmentStatus = "Suspended";
  } else {
    employee.deactivatedAt = undefined;
    employee.deactivatedReason = undefined;
    if (employee.employmentStatus === "Suspended") employee.employmentStatus = "Active";
  }
  await employee.save();
  return employee;
}

/**
 * Permanently remove an employee and every record about them — attendance,
 * leave, salary/payroll history, performance reviews, disciplinary cases,
 * documents, trip logs, notifications — plus their platform login for this
 * org (the whole User account too, if this was their only org). Records that
 * merely reference the employee as *someone else's* manager/reviewer/etc are
 * not deleted, just unlinked, so the org chart and other people's history
 * stay intact. Irreversible — only a Super Admin may call this; Group Admin
 * and HR Manager can edit and deactivate an employee but not delete one.
 */
export async function deleteEmployee(orgId, id, actor) {
  if (!hasPermission(actor?.permissions, "*")) {
    throw AppError.forbidden("Only a Super Admin can delete an employee");
  }
  const employee = await Employee.findOne({ _id: id, organizationId: orgId });
  if (!employee) throw AppError.notFound("Employee not found");

  const [
    { Attendance },
    { LeaveRequest },
    { LeaveBalance },
    { SalaryStructure },
    { Payslip },
    { PerformanceReview },
    { DisciplinaryCase },
    { HrDocument },
    { TripLog },
    { Notification },
    { Target },
    { JobPosting },
    { Applicant },
  ] = await Promise.all([
    import("../models/hrm/Attendance.js"),
    import("../models/hrm/LeaveRequest.js"),
    import("../models/hrm/LeaveBalance.js"),
    import("../models/hrm/SalaryStructure.js"),
    import("../models/hrm/Payslip.js"),
    import("../models/hrm/PerformanceReview.js"),
    import("../models/hrm/DisciplinaryCase.js"),
    import("../models/hrm/HrDocument.js"),
    import("../models/hrm/TripLog.js"),
    import("../models/hrm/Notification.js"),
    import("../models/hrm/Target.js"),
    import("../models/hrm/JobPosting.js"),
    import("../models/hrm/Applicant.js"),
  ]);

  // Records owned by / about this employee — deleted outright.
  await Promise.all([
    Attendance.deleteMany({ organizationId: orgId, employee: id }),
    LeaveRequest.deleteMany({ organizationId: orgId, employee: id }),
    LeaveBalance.deleteMany({ organizationId: orgId, employee: id }),
    SalaryStructure.deleteMany({ organizationId: orgId, employee: id }),
    Payslip.deleteMany({ organizationId: orgId, employee: id }),
    PerformanceReview.deleteMany({ organizationId: orgId, employee: id }),
    DisciplinaryCase.deleteMany({ organizationId: orgId, employee: id }),
    HrDocument.deleteMany({ organizationId: orgId, employee: id }),
    TripLog.deleteMany({ organizationId: orgId, employee: id }),
    Notification.deleteMany({ organizationId: orgId, recipientEmployee: id }),
    Target.deleteMany({ organizationId: orgId, employee: id }),
  ]);

  // Records that name this employee as someone else's manager/reviewer/etc —
  // unlinked, not deleted.
  await Promise.all([
    Employee.updateMany({ organizationId: orgId, reportingManager: id }, { $unset: { reportingManager: 1 } }),
    Department.updateMany({ organizationId: orgId, head: id }, { $unset: { head: 1 } }),
    Branch.updateMany({ organizationId: orgId, manager: id }, { $unset: { manager: 1 } }),
    LeaveRequest.updateMany({ organizationId: orgId, lineManager: id }, { $unset: { lineManager: 1 } }),
    PerformanceReview.updateMany({ organizationId: orgId, reviewer: id }, { $unset: { reviewer: 1 } }),
    DisciplinaryCase.updateMany({ organizationId: orgId, reportedBy: id }, { $unset: { reportedBy: 1 } }),
    JobPosting.updateMany({ organizationId: orgId, hiringManager: id }, { $unset: { hiringManager: 1 } }),
    Applicant.updateMany({ organizationId: orgId, assignedRecruiter: id }, { $unset: { assignedRecruiter: 1 } }),
    Applicant.updateMany({ organizationId: orgId, convertedToEmployee: id }, { $unset: { convertedToEmployee: 1 } }),
  ]);

  // Platform login: drop this org's membership; if that was their only org,
  // the account itself is deleted.
  if (employee.user) {
    const user = await User.findById(employee.user);
    if (user) {
      user.memberships = user.memberships.filter((m) => String(m.organization) !== String(orgId));
      if (user.memberships.length === 0) {
        await User.deleteOne({ _id: user._id });
      } else {
        await user.save();
      }
    }
  }

  await Employee.deleteOne({ _id: id, organizationId: orgId });
  return { deleted: true, name: employee.fullName, employeeId: employee.employeeId };
}

/** Close the currently-open history entry (the one without a `to`). */
function closeOpen(list, at) {
  const open = list.find((e) => !e.to);
  if (open) open.to = at;
}

export default {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  deleteEmployee,
  getEmployeeLogin,
  updateEmployeeLogin,
  resetEmployeeLoginPassword,
};
