import mongoose from "mongoose";
import { Communication } from "../../models/crm/Communication.js";
import { Customer } from "../../models/crm/Customer.js";
import { Organization } from "../../models/hrm/Organization.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import { registerHistoryProvider } from "./registry.js";
import * as customerService from "./customer.service.js";
import { sendEmail, resolveAttachments } from "./email.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

export async function logCommunication(tenantId, actor, input) {
  let customer = null;
  if (input.customer) {
    customer = await Customer.findOne({ _id: input.customer, tenantId });
    if (!customer) throw AppError.badRequest("Unknown customer");
  }

  const comm = await Communication.create({
    tenantId,
    customer: customer?._id,
    channel: input.channel,
    direction: input.direction || "outbound",
    subject: input.subject,
    body: input.body,
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    durationSeconds: input.durationSeconds,
    outcome: input.outcome,
    relatedType: input.relatedType || "",
    relatedId: input.relatedId ? oid(input.relatedId) : undefined,
    relatedLabel: input.relatedLabel,
    attachments: input.attachments || [],
    by: actor.userId,
    byName: actor.name,
    source: input.source || "manual",
  });

  if (customer) {
    await customerService.bumpStats(tenantId, customer._id, {});
  }
  return comm;
}

/**
 * The CRM "Emails" tab — an actual outbound email (via Resend, sent as the
 * org's own brand identity), not just a logged record. Logged as a
 * Communication afterward so it also shows up in the customer's history
 * alongside calls/notes/etc.
 */
export async function sendEmailToCustomer(tenantId, actor, { customer: customerId, subject, body, attachments }) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw AppError.badRequest("Unknown customer");
  const to = customer.primaryEmail;
  if (!to) throw AppError.badRequest("This customer has no email on file");

  const org = await Organization.findById(tenantId);
  const resolvedAttachments = attachments?.length ? await resolveAttachments(tenantId, attachments) : undefined;
  await sendEmail(org?.code, {
    to,
    subject,
    html: body.replace(/\n/g, "<br>"),
    text: body,
    attachments: resolvedAttachments,
  });

  return logCommunication(tenantId, actor, {
    customer: customerId,
    channel: "email",
    direction: "outbound",
    subject,
    body,
    attachments: (attachments || []).map((a) => ({ name: a.name, url: `/api/hrm/files/${a.id}` })),
    source: "manual",
  });
}

export async function listCommunications(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };
  if (query.customer) filter.customer = oid(query.customer);
  if (query.channel) filter.channel = query.channel;
  if (query.direction) filter.direction = query.direction;
  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = new Date(query.from);
    if (query.to) filter.occurredAt.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ subject: rx }, { body: rx }, { relatedLabel: rx }];
  }
  const [items, total] = await Promise.all([
    Communication.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit),
    Communication.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function deleteCommunication(tenantId, id) {
  const res = await Communication.deleteOne({ _id: id, tenantId });
  if (res.deletedCount === 0) throw AppError.notFound("Communication not found");
  return { deleted: true };
}

/* Feed the Customer-360 timeline. */
registerHistoryProvider("communications", async (tenantId, customerId, opts = {}) => {
  const rows = await Communication.find({ tenantId, customer: customerId })
    .sort({ occurredAt: -1 })
    .limit(opts.limit || 30);
  return rows.map((c) => ({
    type: "communication",
    title: `${c.channel}${c.direction ? ` (${c.direction})` : ""}${c.subject ? ` — ${c.subject}` : ""}`,
    description: c.body?.slice(0, 200),
    at: c.occurredAt,
    status: c.outcome || undefined,
    meta: { channel: c.channel, by: c.byName },
  }));
});

export default { logCommunication, sendEmailToCustomer, listCommunications, deleteCommunication };
