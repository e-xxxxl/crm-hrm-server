import crypto from "node:crypto";
import { Employee } from "../models/hrm/Employee.js";
import { Organization } from "../models/hrm/Organization.js";
import { Department } from "../models/hrm/Department.js";
import { Branch } from "../models/hrm/Branch.js";
import { User } from "../models/hrm/User.js";
import { nextCode } from "../models/hrm/Counter.js";
import { AppError } from "../utils/AppError.js";
import { ROLES, hasPermission } from "../utils/permissions.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";

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
 * Give an employee a platform login (idempotent-ish; refuses if email taken by
 * another org-less account). Granting the Super Admin role itself requires the
 * caller to already hold it (`actorPermissions` carries the wildcard `*`) —
 * otherwise any role with plain `employee:write` could mint itself an admin.
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
    user.memberships.push({ organization: orgId, role, status: "active", employee: employee._id });
    await user.save();
  } else {
    const m = user.membershipFor(orgId);
    m.employee = employee._id;
    await user.save();
  }

  employee.user = user._id;
  await employee.save();
  return { user, tempPassword: user.mustChangePassword ? tempPassword : null };
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
};
