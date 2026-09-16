import * as service from "../services/organization.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  const result = await service.listOrganizations(req.auth, req.query);
  res.json(result);
});

export const get = catchAsync(async (req, res) => {
  const result = await service.getOrganization(req.auth, req.params.id);
  res.json({ data: result });
});

export const create = catchAsync(async (req, res) => {
  const org = await service.createOrganization(req.auth, req.body);
  await recordAudit(req, {
    organizationId: org._id,
    action: "organization.create",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `Created organization ${org.name}`,
  });
  res.status(201).json({ data: org });
});

export const update = catchAsync(async (req, res) => {
  const org = await service.updateOrganization(req.auth, req.params.id, req.body);
  await recordAudit(req, {
    organizationId: org._id,
    action: "organization.update",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `Updated organization ${org.name}`,
  });
  res.json({ data: org });
});

export const setStatus = catchAsync(async (req, res) => {
  const org = await service.setOrganizationStatus(req.auth, req.params.id, req.body.status);
  await recordAudit(req, {
    organizationId: org._id,
    action: "organization.status",
    entityType: "Organization",
    entityId: org._id,
    entityLabel: org.name,
    summary: `Set organization status to ${org.status}`,
  });
  res.json({ data: org });
});

export default { list, get, create, update, setStatus };
