import * as service from "../../services/crm/externalSync.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

export const status = catchAsync(async (req, res) => {
  res.json({ data: service.externalSourceStatus() });
});

export const runAjcl = catchAsync(async (req, res) => {
  const stats = await service.syncAjcl(req.tenantId, req.body);
  await recordAudit(req, { action: "sync.ajcl", entityType: "Sync", summary: `Synced from AJCL live DB: ${JSON.stringify(stats)}` });
  res.json({ data: stats });
});

export const runQuickShip = catchAsync(async (req, res) => {
  const stats = await service.syncQuickShip(req.tenantId, req.body);
  await recordAudit(req, { action: "sync.quickship", entityType: "Sync", summary: `Synced from QuickShip live DB: ${JSON.stringify(stats)}` });
  res.json({ data: stats });
});

export const runTradies = catchAsync(async (req, res) => {
  const stats = await service.syncTradies(req.tenantId, req.body);
  await recordAudit(req, { action: "sync.tradies", entityType: "Sync", summary: `Synced from 9jaTradies live DB: ${JSON.stringify(stats)}` });
  res.json({ data: stats });
});

export default { status, runAjcl, runQuickShip, runTradies };
