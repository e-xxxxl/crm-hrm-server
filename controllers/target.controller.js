import * as service from "../services/target.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { notify } from "../services/notification.service.js";

export const summary = catchAsync(async (req, res) => {
  res.json({ data: await service.summary(req.orgId) });
});

export const list = catchAsync(async (req, res) => {
  res.json(await service.listTargets(req.orgId, req.auth, req.query));
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getTarget(req.orgId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const target = await service.createTarget(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "target.create",
    entityType: "Target",
    entityId: target.id,
    entityLabel: target.reference,
    summary: `Created target "${target.title}"`,
  });
  if (target.employee?.id) {
    await notify(req.orgId, {
      to: { employee: target.employee.id },
      type: "target.deadline",
      title: "A new target has been assigned to you",
      body: `${target.title} — due ${new Date(target.deadline).toLocaleDateString("en-NG")}`,
      link: `/hrm/targets/${target.id}`,
    });
  }
  res.status(201).json({ data: target });
});

export const update = catchAsync(async (req, res) => {
  res.json({ data: await service.updateTarget(req.orgId, req.params.id, req.body) });
});

export const addProgress = catchAsync(async (req, res) => {
  const target = await service.addProgress(req.orgId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "target.progress",
    entityType: "Target",
    entityId: target.id,
    summary: `Progress on "${target.title}" → ${target.currentValue} (${target.progressPercent}%)`,
  });
  res.json({ data: target });
});

export default { summary, list, get, create, update, addProgress };
