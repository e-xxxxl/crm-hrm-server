import { Organization } from "../models/hrm/Organization.js";
import { Employee } from "../models/hrm/Employee.js";
import { Branch } from "../models/hrm/Branch.js";
import { Department } from "../models/hrm/Department.js";
import { AppError } from "../utils/AppError.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../utils/query.js";

const SORTABLE = ["name", "code", "createdAt", "status"];

/**
 * List organizations. Platform admins (Super/Group Admin) see all; everyone
 * else sees only the org on their active session.
 */
export async function listOrganizations(auth, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { name: 1 });

  const filter = {};
  const isPlatformAdmin = auth.role === "Super Admin" || auth.role === "Group Admin";
  if (!isPlatformAdmin) filter._id = auth.organizationId;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { code: rx }, { legalName: rx }];
  }

  const [items, total] = await Promise.all([
    Organization.find(filter).sort(sort).skip(skip).limit(limit),
    Organization.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getOrganization(auth, id) {
  const isPlatformAdmin = auth.role === "Super Admin" || auth.role === "Group Admin";
  if (!isPlatformAdmin && String(id) !== String(auth.organizationId)) {
    throw AppError.forbidden("You can only view your own organization");
  }
  const org = await Organization.findById(id);
  if (!org) throw AppError.notFound("Organization not found");

  const [employees, branches, departments] = await Promise.all([
    Employee.countDocuments({ organizationId: org._id, status: "active" }),
    Branch.countDocuments({ organizationId: org._id }),
    Department.countDocuments({ organizationId: org._id }),
  ]);
  return { organization: org, stats: { employees, branches, departments } };
}

export async function createOrganization(auth, input) {
  if (auth.role !== "Super Admin" && auth.role !== "Group Admin") {
    throw AppError.forbidden("Only platform administrators can create organizations");
  }
  const exists = await Organization.findOne({
    $or: [{ slug: input.slug }, { code: input.code }],
  });
  if (exists) throw AppError.conflict("An organization with that slug or code already exists");
  return Organization.create(input);
}

export async function updateOrganization(auth, id, input) {
  const isPlatformAdmin = auth.role === "Super Admin" || auth.role === "Group Admin";
  if (!isPlatformAdmin && String(id) !== String(auth.organizationId)) {
    throw AppError.forbidden("You can only edit your own organization");
  }
  // Brand Admins may edit profile/settings but not the payroll strategy or codes.
  if (!isPlatformAdmin) {
    delete input.payrollStrategy;
    delete input.slug;
    delete input.code;
    delete input.status;
  }
  const org = await Organization.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
  if (!org) throw AppError.notFound("Organization not found");
  return org;
}

export async function setOrganizationStatus(auth, id, status) {
  if (auth.role !== "Super Admin" && auth.role !== "Group Admin") {
    throw AppError.forbidden("Only platform administrators can change organization status");
  }
  const org = await Organization.findByIdAndUpdate(id, { $set: { status } }, { new: true });
  if (!org) throw AppError.notFound("Organization not found");
  return org;
}

export default {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  setOrganizationStatus,
};
