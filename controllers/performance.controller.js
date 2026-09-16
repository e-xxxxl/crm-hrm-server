import * as service from "../services/performance.service.js";
import { catchAsync } from "../utils/catchAsync.js";
import { recordAudit } from "../services/audit.service.js";
import { notify } from "../services/notification.service.js";

export const dashboard = catchAsync(async (req, res) => {
  res.json({ data: await service.dashboard(req.orgId, req.query) });
});

export const listKpis = catchAsync(async (req, res) => {
  res.json({ data: await service.listKpis(req.orgId, req.query) });
});
export const createKpi = catchAsync(async (req, res) => {
  const kpi = await service.createKpi(req.orgId, req.body);
  await recordAudit(req, { action: "kpi.create", entityType: "Kpi", entityId: kpi._id, entityLabel: kpi.name, summary: `Created KPI ${kpi.name}` });
  res.status(201).json({ data: kpi });
});
export const updateKpi = catchAsync(async (req, res) => {
  res.json({ data: await service.updateKpi(req.orgId, req.params.id, req.body) });
});

export const listReviews = catchAsync(async (req, res) => {
  res.json(await service.listReviews(req.orgId, req.auth, req.query));
});
export const getReview = catchAsync(async (req, res) => {
  res.json({ data: await service.getReview(req.orgId, req.params.id) });
});
export const createReview = catchAsync(async (req, res) => {
  const review = await service.createReview(req.orgId, req.auth, req.body);
  await recordAudit(req, {
    action: "performance.create",
    entityType: "PerformanceReview",
    entityId: review.id,
    summary: `Created ${review.cycle} review for ${review.employee?.firstName} ${review.employee?.lastName}`,
  });
  if (review.reviewer?._id) {
    await notify(req.orgId, {
      to: { employee: review.reviewer._id },
      type: "review.due",
      title: "You have been assigned a performance review",
      body: `${review.employee?.firstName} ${review.employee?.lastName} · ${review.cycle}`,
      link: `/hrm/performance/${review.id}`,
    });
  }
  res.status(201).json({ data: review });
});
export const updateReview = catchAsync(async (req, res) => {
  res.json({ data: await service.updateReview(req.orgId, req.auth, req.params.id, req.body) });
});
export const transitionReview = catchAsync(async (req, res) => {
  const review = await service.transitionReview(req.orgId, req.auth, req.params.id, req.body.action);
  await recordAudit(req, {
    action: `performance.${req.body.action}`,
    entityType: "PerformanceReview",
    entityId: review.id,
    summary: `Review ${review.cycle} → ${review.status}`,
  });
  if (review.status === "completed" && review.employee?._id) {
    await notify(req.orgId, {
      to: { employee: review.employee._id },
      type: "review.due",
      title: "Your performance review is ready",
      body: `${review.cycle} · overall ${review.overallScore}/5 — please acknowledge`,
      link: `/hrm/performance/${review.id}`,
    });
  }
  res.json({ data: review });
});

export default {
  dashboard,
  listKpis,
  createKpi,
  updateKpi,
  listReviews,
  getReview,
  createReview,
  updateReview,
  transitionReview,
};
