import * as service from "../../services/crm/rider.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

/* ---- Dispatch: rider directory ---- */

export const list = catchAsync(async (req, res) => {
  res.json(await service.listRiders(req.tenantId, req.query));
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getRider(req.tenantId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const { rider, login } = await service.createRider(req.tenantId, req.auth, req.body);
  await recordAudit(req, {
    action: "rider.create",
    entityType: "Rider",
    entityId: rider._id,
    entityLabel: rider.riderCode,
    summary: `Added rider ${rider.name} (${rider.riderCode})`,
  });
  res.status(201).json({ data: rider, meta: login ? { login } : undefined });
});

export const update = catchAsync(async (req, res) => {
  const rider = await service.updateRider(req.tenantId, req.params.id, req.body);
  res.json({ data: rider });
});

export const provisionLogin = catchAsync(async (req, res) => {
  const login = await service.provisionRiderLogin(req.tenantId, req.params.id, req.body);
  await recordAudit(req, {
    action: "rider.provision_login",
    entityType: "Rider",
    entityId: req.params.id,
    summary: `Provisioned a rider login`,
  });
  res.status(201).json({ data: login });
});

/* ---- Dispatch: board / map / optimise ---- */

export const board = catchAsync(async (req, res) => {
  res.json({ data: await service.dispatchBoard(req.tenantId) });
});

export const map = catchAsync(async (req, res) => {
  res.json({ data: await service.dispatchMap(req.tenantId) });
});

export const optimize = catchAsync(async (req, res) => {
  res.json({ data: await service.optimizeRoute(req.tenantId, req.body) });
});

/* ---- Rider PWA ---- */

export const myDashboard = catchAsync(async (req, res) => {
  res.json({ data: await service.riderDashboard(req.tenantId, req.auth.userId) });
});

export const myJob = catchAsync(async (req, res) => {
  res.json({ data: await service.riderJob(req.tenantId, req.auth.userId, req.params.id) });
});

export const jobAction = catchAsync(async (req, res) => {
  const result = await service.riderAction(req.tenantId, req.auth.userId, req.params.id, req.params.action, req.body);
  res.json({ data: result });
});

export const updateLocation = catchAsync(async (req, res) => {
  res.json({ data: await service.updateLocation(req.tenantId, req.auth.userId, req.body) });
});

export const setAvailability = catchAsync(async (req, res) => {
  res.json({ data: await service.setAvailability(req.tenantId, req.auth.userId, req.body.availability) });
});

export default {
  list,
  get,
  create,
  update,
  provisionLogin,
  board,
  map,
  optimize,
  myDashboard,
  myJob,
  jobAction,
  updateLocation,
  setAvailability,
};
