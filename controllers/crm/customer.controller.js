import * as service from "../../services/crm/customer.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listCustomers(req.tenantId, req.query));
});

export const search = catchAsync(async (req, res) => {
  res.json({ data: await service.search(req.tenantId, req.query.q || req.query.term) });
});

export const segments = catchAsync(async (req, res) => {
  res.json({ data: await service.listSegments(req.tenantId) });
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getCustomer(req.tenantId, req.params.id) });
});

export const overview = catchAsync(async (req, res) => {
  res.json({
    data: await service.getCustomer360(req.tenantId, req.params.id, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
  });
});

export const create = catchAsync(async (req, res) => {
  const customer = await service.createCustomer(req.tenantId, req.auth, req.body);
  await recordAudit(req, {
    action: "customer.create",
    entityType: "Customer",
    entityId: customer._id,
    entityLabel: customer.displayName,
    summary: `Created customer ${customer.displayName} (${customer.customerId})`,
  });
  res.status(201).json({ data: customer });
});

export const update = catchAsync(async (req, res) => {
  const customer = await service.updateCustomer(req.tenantId, req.params.id, req.body);
  await recordAudit(req, {
    action: "customer.update",
    entityType: "Customer",
    entityId: customer._id,
    entityLabel: customer.displayName,
    summary: `Updated customer ${customer.displayName}`,
  });
  res.json({ data: customer });
});

export const addNote = catchAsync(async (req, res) => {
  const customer = await service.addNote(req.tenantId, req.auth, req.params.id, req.body.body);
  res.json({ data: customer });
});

export const setStatus = catchAsync(async (req, res) => {
  const customer = await service.setStatus(req.tenantId, req.params.id, req.body.status, req.body.reason);
  await recordAudit(req, {
    action: "customer.status",
    entityType: "Customer",
    entityId: customer._id,
    entityLabel: customer.displayName,
    summary: `Set customer ${customer.displayName} to ${customer.status}`,
  });
  res.json({ data: customer });
});

export default { list, search, segments, get, overview, create, update, addNote, setStatus };
