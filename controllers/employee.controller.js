import * as service from "../services/employee.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { hasPermission } from "../utils/permissions.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listEmployees(req.orgId, req.query));
});

export const get = catchAsync(async (req, res) => {
  const includeSensitive = hasPermission(req.auth.permissions, "employee:read_sensitive");
  const employee = await service.getEmployee(req.orgId, req.params.id, { includeSensitive });
  res.json({ data: employee });
});

export const create = catchAsync(async (req, res) => {
  const { employee, login } = await service.createEmployee(req.orgId, req.body, req.auth.userId, req.auth.permissions);
  await recordAudit(req, {
    action: "employee.create",
    entityType: "Employee",
    entityId: employee._id,
    entityLabel: employee.fullName,
    summary: `Created employee ${employee.fullName} (${employee.employeeId})${
      login ? " with a platform login" : ""
    }`,
  });
  res.status(201).json({ data: employee, meta: login ? { login } : undefined });
});

export const update = catchAsync(async (req, res) => {
  const employee = await service.updateEmployee(req.orgId, req.params.id, req.body, req.auth.userId);
  await recordAudit(req, {
    action: "employee.update",
    entityType: "Employee",
    entityId: employee._id,
    entityLabel: employee.fullName,
    summary: `Updated employee ${employee.fullName}`,
    changes: Object.keys(req.body).reduce((acc, k) => ((acc[k] = { to: req.body[k] }), acc), {}),
  });
  res.json({ data: employee });
});

export const provisionLogin = catchAsync(async (req, res) => {
  const employee = await service.getEmployee(req.orgId, req.params.id);
  const { user, tempPassword } = await service.provisionEmployeeLogin(req.orgId, employee, req.body, req.auth.permissions);
  await recordAudit(req, {
    action: "employee.provision_login",
    entityType: "Employee",
    entityId: employee._id,
    entityLabel: employee.fullName,
    summary: `Provisioned a ${req.body.role} login for ${employee.fullName}`,
  });
  res.status(201).json({ data: { userId: user._id, email: user.email }, meta: { tempPassword } });
});

export const setStatus = catchAsync(async (req, res) => {
  const employee = await service.setEmployeeStatus(
    req.orgId,
    req.params.id,
    req.body.status,
    req.body.reason,
    req.auth.userId,
  );
  await recordAudit(req, {
    action: employee.status === "active" ? "employee.reactivate" : "employee.deactivate",
    entityType: "Employee",
    entityId: employee._id,
    entityLabel: employee.fullName,
    summary:
      employee.status === "active"
        ? `Reactivated employee ${employee.fullName}`
        : `Deactivated employee ${employee.fullName}${req.body.reason ? ` — ${req.body.reason}` : ""}`,
  });
  res.json({ data: employee });
});

export default { list, get, create, update, provisionLogin, setStatus };
