import * as service from "../../services/crm/marketplace.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

/* ---- Businesses ---- */
export const listBusinesses = catchAsync(async (req, res) => {
  res.json(await service.listBusinesses(req.tenantId, req.query));
});
export const businessStats = catchAsync(async (req, res) => {
  res.json({ data: await service.businessStats(req.tenantId) });
});
export const getBusiness = catchAsync(async (req, res) => {
  res.json({ data: await service.getBusiness(req.tenantId, req.params.id) });
});
export const createBusiness = catchAsync(async (req, res) => {
  const b = await service.createBusiness(req.tenantId, req.auth, req.body);
  await recordAudit(req, { action: "business.create", entityType: "Business", entityId: b._id, entityLabel: b.name, summary: `Registered business ${b.name} (${b.businessCode})` });
  res.status(201).json({ data: b });
});
export const updateBusiness = catchAsync(async (req, res) => {
  res.json({ data: await service.updateBusiness(req.tenantId, req.params.id, req.body) });
});
export const moderateBusiness = catchAsync(async (req, res) => {
  const b = await service.moderateBusiness(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, { action: `business.${req.body.decision}`, entityType: "Business", entityId: b._id, entityLabel: b.name, summary: `${req.body.decision} business ${b.name}` });
  res.json({ data: b });
});
export const setSubscription = catchAsync(async (req, res) => {
  const b = await service.setSubscription(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, { action: "business.subscription", entityType: "Business", entityId: b._id, entityLabel: b.name, summary: `Set ${b.name} subscription to ${req.body.tier}` });
  res.json({ data: b });
});

/* ---- Leads ---- */
export const listLeads = catchAsync(async (req, res) => {
  res.json(await service.listLeads(req.tenantId, req.auth, req.query));
});
export const leadBoard = catchAsync(async (req, res) => {
  res.json({ data: await service.leadBoard(req.tenantId, req.auth, req.query) });
});
export const leadStats = catchAsync(async (req, res) => {
  res.json({ data: await service.leadStats(req.tenantId) });
});
export const getLead = catchAsync(async (req, res) => {
  res.json({ data: await service.getLead(req.tenantId, req.params.id) });
});
export const createLead = catchAsync(async (req, res) => {
  const l = await service.createLead(req.tenantId, req.auth, req.body);
  await recordAudit(req, { action: "lead.create", entityType: "Lead", entityId: l._id, entityLabel: l.reference, summary: `New lead ${l.reference} — ${l.title}` });
  res.status(201).json({ data: l });
});
export const moveLeadStage = catchAsync(async (req, res) => {
  const l = await service.moveLeadStage(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, { action: "lead.stage", entityType: "Lead", entityId: l._id, entityLabel: l.reference, summary: `Lead ${l.reference} → ${l.stage}` });
  res.json({ data: l });
});
export const addLeadActivity = catchAsync(async (req, res) => {
  res.json({ data: await service.addLeadActivity(req.tenantId, req.auth, req.params.id, req.body) });
});
export const assignLead = catchAsync(async (req, res) => {
  res.json({ data: await service.assignLead(req.tenantId, req.auth, req.params.id, req.body) });
});

/* ---- Reviews ---- */
export const listReviews = catchAsync(async (req, res) => {
  res.json(await service.listReviews(req.tenantId, req.query));
});
export const createReview = catchAsync(async (req, res) => {
  const r = await service.createReview(req.tenantId, req.auth, req.body);
  res.status(201).json({ data: r });
});
export const moderateReview = catchAsync(async (req, res) => {
  const r = await service.moderateReview(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, { action: `review.${req.body.decision}`, entityType: "Review", entityId: r._id, entityLabel: r.businessName, summary: `${req.body.decision} review for ${r.businessName}` });
  res.json({ data: r });
});
export const respondToReview = catchAsync(async (req, res) => {
  res.json({ data: await service.respondToReview(req.tenantId, req.auth, req.params.id, req.body) });
});

export default {
  listBusinesses, businessStats, getBusiness, createBusiness, updateBusiness, moderateBusiness, setSubscription,
  listLeads, leadBoard, leadStats, getLead, createLead, moveLeadStage, addLeadActivity, assignLead,
  listReviews, createReview, moderateReview, respondToReview,
};
