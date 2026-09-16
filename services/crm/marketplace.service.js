import mongoose from "mongoose";
import { Business } from "../../models/crm/Business.js";
import { Lead, LEAD_TRANSITIONS } from "../../models/crm/Lead.js";
import { Review } from "../../models/crm/Review.js";
import { Customer } from "../../models/crm/Customer.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import { registerHistoryProvider } from "./registry.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/* ============================== BUSINESSES ============================== */

export async function createBusiness(tenantId, actor, input) {
  const dup = await Business.findOne({ tenantId, name: input.name, phone: input.phone });
  if (dup) throw AppError.conflict("A business with that name and phone already exists");

  const businessCode = await nextCode("BIZ", `${tenantId}:business`, 5);
  const business = await Business.create({
    tenantId,
    businessCode,
    name: input.name,
    slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    owner: input.owner ? oid(input.owner) : undefined,
    ownerName: input.ownerName,
    category: input.category,
    services: input.services || [],
    description: input.description,
    phone: input.phone,
    whatsapp: input.whatsapp,
    email: input.email,
    address: input.address,
    city: input.city,
    lga: input.lga,
    state: input.state,
    serviceAreas: input.serviceAreas || [],
    ninNumber: input.ninNumber,
    documents: input.documents || [],
    status: "pending",
    reviewLog: [{ action: "submitted", by: actor.userId, byName: actor.name, at: new Date() }],
    subscription: input.subscription || {},
    createdBy: actor.userId,
  });
  return business;
}

export async function listBusinesses(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.state) filter.state = query.state;
  if (query.tier) filter["subscription.tier"] = query.tier;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { ownerName: rx }, { phone: rx }, { businessCode: rx }];
  }
  const [items, total] = await Promise.all([
    Business.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Business.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getBusiness(tenantId, id) {
  const business = await Business.findOne({ _id: id, tenantId });
  if (!business) throw AppError.notFound("Business not found");
  return business;
}

export async function updateBusiness(tenantId, id, input) {
  const business = await Business.findOne({ _id: id, tenantId });
  if (!business) throw AppError.notFound("Business not found");
  const editable = ["name", "category", "services", "description", "phone", "whatsapp", "email", "address", "city", "lga", "state", "serviceAreas", "ninNumber", "documents", "ownerName"];
  for (const k of editable) if (input[k] !== undefined) business[k] = input[k];
  await business.save();
  return business;
}

export async function moderateBusiness(tenantId, actor, id, { decision, reason }) {
  const business = await Business.findOne({ _id: id, tenantId });
  if (!business) throw AppError.notFound("Business not found");

  const map = {
    approve: { status: "approved", action: "approved" },
    reject: { status: "rejected", action: "rejected" },
    suspend: { status: "suspended", action: "suspended" },
    reinstate: { status: "approved", action: "reinstated" },
  };
  const m = map[decision];
  if (!m) throw AppError.badRequest("Unknown moderation decision");
  if (decision === "reject" && !reason) throw AppError.badRequest("A rejection reason is required");

  business.status = m.status;
  business.rejectionReason = decision === "reject" ? reason : undefined;
  business.reviewLog.push({ action: m.action, by: actor.userId, byName: actor.name, reason, at: new Date() });

  if (decision === "approve" && business.subscription.status === "none") {
    business.subscription.tier = business.subscription.tier || "free";
    business.subscription.status = "active";
    business.subscription.startedAt = new Date();
  }
  await business.save();
  return business;
}

export async function setSubscription(tenantId, actor, id, input) {
  const business = await Business.findOne({ _id: id, tenantId });
  if (!business) throw AppError.notFound("Business not found");
  const months = input.months || 1;
  business.subscription = {
    tier: input.tier,
    status: "active",
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + months * 30 * 86400000),
    amount: input.amount || 0,
    autoRenew: Boolean(input.autoRenew),
  };
  business.reviewLog.push({ action: "resubmitted", by: actor.userId, byName: actor.name, reason: `Subscription set to ${input.tier}`, at: new Date() });
  await business.save();
  return business;
}

export async function businessStats(tenantId) {
  const t = oid(tenantId);
  const [byStatus, byTier] = await Promise.all([
    Business.aggregate([{ $match: { tenantId: t } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Business.aggregate([
      { $match: { tenantId: t, status: "approved" } },
      { $group: { _id: "$subscription.tier", n: { $sum: 1 } } },
    ]),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
    bySubscriptionTier: Object.fromEntries(byTier.map((r) => [r._id || "none", r.n])),
    pendingApproval: byStatus.find((r) => r._id === "pending")?.n || 0,
  };
}

/* ================================ LEADS =============================== */

export async function createLead(tenantId, actor, input) {
  const reference = await nextCode("LEAD", `${tenantId}:lead`, 5);
  let customer = null;
  if (input.customer) customer = await Customer.findOne({ _id: input.customer, tenantId });

  const lead = await Lead.create({
    tenantId,
    reference,
    customer: customer?._id,
    contactName: input.contactName || customer?.displayName,
    contactPhone: input.contactPhone || customer?.primaryPhone,
    contactEmail: input.contactEmail || customer?.primaryEmail,
    title: input.title,
    description: input.description,
    serviceCategory: input.serviceCategory,
    location: input.location,
    state: input.state,
    source: input.source || "web",
    owner: input.owner ? oid(input.owner) : actor.userId,
    ownerName: input.ownerName || actor.name,
    estimatedValue: input.estimatedValue || 0,
    stage: "new",
    stageEnteredAt: new Date(),
    activities: [{ type: "note", body: "Lead created", by: actor.userId, byName: actor.name, at: new Date() }],
    createdBy: actor.userId,
  });
  return lead;
}

export async function listLeads(tenantId, actor, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };
  if (query.stage) filter.stage = query.stage;
  if (query.owner) filter.owner = oid(query.owner);
  if (query.mine === "true") filter.owner = oid(actor.userId);
  if (query.serviceCategory) filter.serviceCategory = query.serviceCategory;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ title: rx }, { contactName: rx }, { contactPhone: rx }, { reference: rx }];
  }
  const [items, total] = await Promise.all([
    Lead.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Lead.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function leadBoard(tenantId, actor, query = {}) {
  const filter = { tenantId: oid(tenantId) };
  if (query.mine === "true") filter.owner = oid(actor.userId);
  if (query.serviceCategory) filter.serviceCategory = query.serviceCategory;
  const leads = await Lead.find(filter).sort({ updatedAt: -1 }).limit(500);
  const columns = {};
  for (const stage of ["new", "contacted", "qualified", "quoted", "won", "lost"]) columns[stage] = [];
  for (const l of leads) (columns[l.stage] || (columns[l.stage] = [])).push(l.toJSON());
  return { columns };
}

export async function getLead(tenantId, id) {
  const lead = await Lead.findOne({ _id: id, tenantId });
  if (!lead) throw AppError.notFound("Lead not found");
  return lead;
}

export async function moveLeadStage(tenantId, actor, id, { stage, note, quotedAmount, wonValue, lostReason }) {
  const lead = await Lead.findOne({ _id: id, tenantId });
  if (!lead) throw AppError.notFound("Lead not found");
  const allowed = LEAD_TRANSITIONS[lead.stage] || [];
  if (!allowed.includes(stage)) {
    throw AppError.badRequest(`Cannot move a "${lead.stage}" lead to "${stage}"`);
  }
  if (stage === "lost" && !lostReason && !note) throw AppError.badRequest("Give a reason for marking the lead lost");

  const from = lead.stage;
  lead.stage = stage;
  lead.stageEnteredAt = new Date();
  if (stage === "quoted" && quotedAmount != null) lead.quotedAmount = quotedAmount;
  if (stage === "won") {
    lead.wonValue = wonValue ?? lead.quotedAmount ?? lead.estimatedValue;
    lead.closedAt = new Date();
    if (lead.matchedBusiness) {
      await Business.updateOne({ _id: lead.matchedBusiness, tenantId }, { $inc: { leadsCount: 1 } });
    }
  }
  if (stage === "lost") {
    lead.lostReason = lostReason || note;
    lead.closedAt = new Date();
  }
  lead.activities.push({
    type: "stage_change",
    body: note || `Moved from ${from} to ${stage}`,
    by: actor.userId,
    byName: actor.name,
    at: new Date(),
    meta: { from, to: stage },
  });
  await lead.save();
  return lead;
}

export async function addLeadActivity(tenantId, actor, id, input) {
  const lead = await Lead.findOne({ _id: id, tenantId });
  if (!lead) throw AppError.notFound("Lead not found");
  lead.activities.push({
    type: input.type || "note",
    body: input.body,
    by: actor.userId,
    byName: actor.name,
    at: new Date(),
  });
  if (input.nextFollowUpAt) lead.nextFollowUpAt = new Date(input.nextFollowUpAt);
  await lead.save();
  return lead;
}

export async function assignLead(tenantId, actor, id, { matchedBusiness, owner }) {
  const lead = await Lead.findOne({ _id: id, tenantId });
  if (!lead) throw AppError.notFound("Lead not found");
  if (matchedBusiness !== undefined) {
    const biz = matchedBusiness ? await Business.findOne({ _id: matchedBusiness, tenantId }) : null;
    lead.matchedBusiness = biz?._id;
    lead.matchedBusinessName = biz?.name;
    lead.activities.push({ type: "note", body: `Matched to ${biz?.name || "no business"}`, by: actor.userId, byName: actor.name, at: new Date() });
  }
  if (owner !== undefined) {
    lead.owner = owner ? oid(owner) : undefined;
    lead.ownerName = owner ? undefined : lead.ownerName;
  }
  await lead.save();
  return lead;
}

export async function leadStats(tenantId) {
  const t = oid(tenantId);
  const byStage = await Lead.aggregate([{ $match: { tenantId: t } }, { $group: { _id: "$stage", n: { $sum: 1 }, value: { $sum: "$estimatedValue" } } }]);
  const won = byStage.find((r) => r._id === "won");
  const lost = byStage.find((r) => r._id === "lost");
  const closed = (won?.n || 0) + (lost?.n || 0);
  return {
    byStage: Object.fromEntries(byStage.map((r) => [r._id, r.n])),
    pipelineValue: byStage.filter((r) => !["won", "lost"].includes(r._id)).reduce((s, r) => s + r.value, 0),
    conversionRate: closed > 0 ? Math.round(((won?.n || 0) / closed) * 100) : null,
  };
}

/* =============================== REVIEWS ============================== */

export async function createReview(tenantId, actor, input) {
  const business = await Business.findOne({ _id: input.business, tenantId });
  if (!business) throw AppError.badRequest("Unknown business");
  const review = await Review.create({
    tenantId,
    business: business._id,
    businessName: business.name,
    customer: input.customer ? oid(input.customer) : undefined,
    reviewerName: input.reviewerName,
    reviewerPhone: input.reviewerPhone,
    rating: input.rating,
    title: input.title,
    body: input.body,
    jobDate: input.jobDate,
    status: "pending",
    createdBy: actor.userId,
  });
  return review;
}

export async function listReviews(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };
  if (query.status) filter.status = query.status;
  if (query.business) filter.business = oid(query.business);
  if (query.minRating) filter.rating = { $gte: Number(query.minRating) };
  const [items, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Review.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function moderateReview(tenantId, actor, id, { decision, reason }) {
  const review = await Review.findOne({ _id: id, tenantId });
  if (!review) throw AppError.notFound("Review not found");

  const prevStatus = review.status;
  const map = { publish: "published", reject: "rejected", flag: "flagged" };
  const status = map[decision];
  if (!status) throw AppError.badRequest("Unknown moderation decision");

  review.status = status;
  review.moderation = { by: actor.userId, byName: actor.name, at: new Date(), reason };
  await review.save();

  // Recompute the business rating from published reviews when publish state changes.
  if (prevStatus !== status && (status === "published" || prevStatus === "published")) {
    await recomputeBusinessRating(tenantId, review.business);
  }
  return review;
}

export async function respondToReview(tenantId, actor, id, { body }) {
  const review = await Review.findOne({ _id: id, tenantId });
  if (!review) throw AppError.notFound("Review not found");
  review.businessResponse = { body, at: new Date() };
  await review.save();
  return review;
}

async function recomputeBusinessRating(tenantId, businessId) {
  const agg = await Review.aggregate([
    { $match: { tenantId: oid(tenantId), business: oid(businessId), status: "published" } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const { avg = 0, count = 0 } = agg[0] || {};
  await Business.updateOne(
    { _id: businessId, tenantId },
    { $set: { ratingAverage: Math.round(avg * 10) / 10, ratingCount: count } },
  );
}

/* --------------------------- registry wiring --------------------------- */

registerHistoryProvider("leads", async (tenantId, customerId, opts = {}) => {
  const rows = await Lead.find({ tenantId, customer: customerId }).sort({ createdAt: -1 }).limit(opts.limit || 15);
  return rows.map((l) => ({
    type: "lead",
    title: `${l.reference} — ${l.title}`,
    description: `${l.serviceCategory || "lead"} · ${l.stage}`,
    at: l.createdAt,
    status: l.stage,
    amount: l.wonValue || l.estimatedValue || undefined,
    link: `/crm/leads/${l._id}`,
  }));
});

export default {
  createBusiness,
  listBusinesses,
  getBusiness,
  updateBusiness,
  moderateBusiness,
  setSubscription,
  businessStats,
  createLead,
  listLeads,
  leadBoard,
  getLead,
  moveLeadStage,
  addLeadActivity,
  assignLead,
  leadStats,
  createReview,
  listReviews,
  moderateReview,
  respondToReview,
};
