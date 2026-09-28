/**
 * Role → permission matrix.
 *
 * Permissions are plain `resource:action` strings. The decoded JWT carries the
 * effective permission list for the user's active organization; middleware
 * checks membership against that list. A user whose role is "Super Admin" holds
 * the wildcard "*" and passes every check.
 *
 * Roles are ordered highest-authority first. `roleRank()` is used where a
 * numeric comparison is needed (e.g. a manager may only act on lower roles).
 */

export const ROLES = [
  "Super Admin",
  "Group Admin",
  "Brand Admin",
  "HR Manager",
  "CRM Manager",
  "Finance",
  "Logistics Manager",
  "Dispatcher",
  "Hub Manager",
  "Customer Support",
  "Sales Staff",
  "Rider",
  "Staff",
];

export function roleRank(role) {
  const i = ROLES.indexOf(role);
  return i === -1 ? ROLES.length : i;
}

/** All known permissions, grouped for readability. */
export const PERMISSIONS = {
  // Organization / platform administration
  org: ["org:read", "org:write", "org:manage_members"],
  settings: ["settings:read", "settings:write"],
  audit: ["audit:read"],

  // HRM — people
  employee: ["employee:read", "employee:write", "employee:deactivate", "employee:read_sensitive"],
  department: ["department:read", "department:write"],
  branch: ["branch:read", "branch:write"],

  // HRM — attendance
  attendance: ["attendance:read", "attendance:clock", "attendance:manage", "attendance:report"],

  // HRM — leave
  leave: [
    "leave:read",
    "leave:request",
    "leave:approve_manager",
    "leave:approve_hr",
    "leave:configure",
  ],

  // HRM — payroll
  payroll: [
    "payroll:read",
    "payroll:read_own",
    "payroll:run",
    "payroll:approve",
    "payroll:export",
    "payroll:configure",
  ],

  // HRM — performance & targets
  performance: ["performance:read", "performance:write", "performance:review"],
  target: ["target:read", "target:write", "target:update_progress"],

  // HRM — recruitment
  recruitment: ["recruitment:read", "recruitment:write", "recruitment:move_stage"],

  // HRM — documents
  document: ["document:read", "document:write", "document:write_own", "document:delete"],

  // HRM — trainings
  training: ["training:read", "training:write"],

  // HRM — disciplinary (restricted)
  disciplinary: ["disciplinary:read", "disciplinary:write"],

  // HRM — notifications & reports
  notification: ["notification:read"],
  report: ["report:hr", "report:crm", "report:finance"],

  // CRM — foundational (used from Phase 7 onward)
  customer: ["customer:read", "customer:write"],
  ticket: ["ticket:read", "ticket:write", "ticket:assign", "ticket:escalate"],
  shipment: ["shipment:read", "shipment:write", "shipment:dispatch", "shipment:cod"],
  order: ["order:read", "order:write", "order:dispatch"],
  lead: ["lead:read", "lead:write"],
  business: ["business:read", "business:write", "business:moderate"],
  review: ["review:read", "review:moderate"],
  rider: ["rider:read", "rider:write", "rider:job"],
  task: ["task:read", "task:write"],
  communication: ["communication:read", "communication:write", "communication:delete"],
  invoice: ["invoice:read", "invoice:write"],
};

/** Flattened list of every permission string. */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS).flat();

const P = PERMISSIONS;

/**
 * Base permission sets per role. "Super Admin" is special-cased to "*".
 * Higher roles generally inherit the intent of lower ones but the lists are
 * explicit so an audit can read exactly what each role can do.
 */
export const ROLE_PERMISSIONS = {
  "Super Admin": ["*"],

  "Group Admin": [
    ...P.org,
    ...P.settings,
    ...P.audit,
    ...P.employee,
    ...P.department,
    ...P.branch,
    ...P.attendance,
    ...P.leave,
    ...P.payroll,
    ...P.performance,
    ...P.target,
    ...P.recruitment,
    ...P.document,
    ...P.training,
    ...P.disciplinary,
    ...P.notification,
    ...P.report,
    ...P.customer,
    ...P.ticket,
    ...P.shipment,
    ...P.order,
    ...P.lead,
    ...P.business,
    ...P.review,
    ...P.rider,
    ...P.task,
    ...P.communication,
    ...P.invoice,
  ],

  "Brand Admin": [
    "org:read",
    ...P.settings,
    "audit:read",
    ...P.employee,
    ...P.department,
    ...P.branch,
    ...P.attendance,
    ...P.leave,
    "payroll:read",
    "payroll:export",
    ...P.performance,
    ...P.target,
    ...P.recruitment,
    ...P.document,
    "training:read",
    ...P.disciplinary,
    ...P.notification,
    ...P.report,
    ...P.customer,
    ...P.ticket,
    ...P.shipment,
    ...P.order,
    ...P.lead,
    ...P.business,
    ...P.review,
    ...P.rider,
    ...P.task,
    ...P.communication,
    ...P.invoice,
  ],

  "HR Manager": [
    "org:read",
    "settings:read",
    "settings:write",
    "audit:read",
    ...P.employee,
    ...P.department,
    ...P.branch,
    "attendance:read",
    "attendance:manage",
    "attendance:report",
    ...P.leave,
    // Full payroll access except deleting/reopening a finalized run, which
    // stays Super-Admin-only regardless of permissions (see
    // requireRole("Super Admin") on those routes in payroll.routes.js).
    "payroll:read",
    "payroll:run",
    "payroll:approve",
    "payroll:export",
    "payroll:configure",
    ...P.performance,
    ...P.target,
    ...P.recruitment,
    ...P.document,
    ...P.training,
    ...P.disciplinary,
    "notification:read",
    "report:hr",
    // HR edits rider profiles (name, phone, vehicle, docs) in the CRM Riders
    // directory, alongside Super Admin and CRM Manager.
    "rider:read",
    "rider:write",
  ],

  "CRM Manager": [
    "org:read",
    "employee:read",
    "department:read",
    "branch:read",
    "notification:read",
    "report:crm",
    ...P.customer,
    ...P.ticket,
    ...P.shipment,
    ...P.order,
    ...P.lead,
    ...P.business,
    ...P.review,
    ...P.rider,
    ...P.task,
    ...P.communication,
    ...P.invoice,
  ],

  "Finance": [
    "org:read",
    "employee:read",
    "employee:read_sensitive",
    "department:read",
    "branch:read",
    "payroll:read",
    "payroll:run",
    "payroll:approve",
    "payroll:export",
    "payroll:configure",
    "notification:read",
    "report:hr",
    "report:finance",
  ],

  "Logistics Manager": [
    "org:read",
    "employee:read",
    "branch:read",
    "notification:read",
    "report:crm",
    "customer:read",
    "ticket:read",
    "ticket:write",
    "ticket:assign",
    ...P.shipment,
    ...P.order,
    ...P.rider,
    "task:read",
    "task:write",
    "communication:read",
    "communication:write",
    "invoice:read",
    "invoice:write",
    "report:crm",
  ],

  "Dispatcher": [
    "org:read",
    "notification:read",
    "customer:read",
    "ticket:read",
    "ticket:write",
    "shipment:read",
    "shipment:write",
    "shipment:dispatch",
    "order:read",
    "order:write",
    "order:dispatch",
    "rider:read",
    "rider:job",
    "task:read",
    "task:write",
  ],

  "Hub Manager": [
    "org:read",
    "employee:read",
    "branch:read",
    "attendance:read",
    "attendance:report",
    "notification:read",
    "shipment:read",
    "shipment:write",
    "order:read",
    "rider:read",
  ],

  "Customer Support": [
    "org:read",
    "notification:read",
    "customer:read",
    "customer:write",
    "ticket:read",
    "ticket:write",
    "shipment:read",
    "order:read",
    "lead:read",
    "business:read",
    "review:read",
    "task:read",
    "task:write",
    "communication:read",
    "communication:write",
    "invoice:read",
    "invoice:write",
  ],

  "Sales Staff": [
    "org:read",
    "notification:read",
    "customer:read",
    "customer:write",
    "lead:read",
    "lead:write",
    "business:read",
    "business:write",
    "review:read",
    "ticket:read",
    "target:read",
    "target:update_progress",
    "task:read",
    "task:write",
    "communication:read",
    "communication:write",
    "invoice:read",
    "invoice:write",
    "report:crm",
  ],

  // Every employee-tier role also gets a baseline CRM working set (not just
  // read access) so they can switch into the CRM workspace and do real work
  // there — creating/updating customers, tickets and tasks, logging
  // communications. Every write still runs through the normal controllers,
  // so it's attributed to them via audit log + createdBy/uploadedBy exactly
  // like everyone else's actions.
  "Rider": [
    "org:read",
    "notification:read",
    "attendance:clock",
    "attendance:read",
    "leave:read",
    "leave:request",
    "payroll:read_own",
    "rider:job",
    "shipment:read",
    "order:read",
    "document:read",
    "document:write_own",
    "training:read",
    "customer:read",
    "customer:write",
    "ticket:read",
    "ticket:write",
    "lead:read",
    "business:read",
    "review:read",
    "task:read",
    "task:write",
    "communication:read",
    "communication:write",
    "invoice:read",
    "invoice:write",
  ],

  "Staff": [
    "org:read",
    "notification:read",
    "attendance:clock",
    "attendance:read",
    "leave:read",
    "leave:request",
    "payroll:read_own",
    "performance:read",
    "target:read",
    "target:update_progress",
    "document:read",
    "document:write_own",
    "training:read",
    "customer:read",
    "customer:write",
    "ticket:read",
    "ticket:write",
    "shipment:read",
    "order:read",
    "lead:read",
    "business:read",
    "review:read",
    "task:read",
    "task:write",
    "communication:read",
    "communication:write",
    "invoice:read",
    "invoice:write",
  ],
};

/**
 * Resolve the effective permission list for a role plus any per-membership
 * permission overrides (grants/revokes stored on the user's org membership).
 */
export function resolvePermissions(role, { grant = [], revoke = [] } = {}) {
  const base = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Staff;
  if (base.includes("*")) return ["*"];
  const set = new Set([...base, ...grant]);
  for (const r of revoke) set.delete(r);
  return [...set];
}

/** True when `permissions` satisfies `required` (wildcard aware). */
export function hasPermission(permissions, required) {
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes("*")) return true;
  return permissions.includes(required);
}

export default {
  ROLES,
  roleRank,
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  resolvePermissions,
  hasPermission,
};
