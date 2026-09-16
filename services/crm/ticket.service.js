import mongoose from "mongoose";
import { Ticket, PRIORITY_SLA_FACTOR } from "../../models/crm/Ticket.js";
import { TicketUpdate } from "../../models/crm/TicketUpdate.js";
import { Customer } from "../../models/crm/Customer.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { hasPermission } from "../../utils/permissions.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import { notify } from "../notification.service.js";
import { getCurrentBrand } from "./brand.service.js";
import { registerHistoryProvider, registerCustomerResolver } from "./registry.js";
import * as customerService from "./customer.service.js";
import { User } from "../../models/hrm/User.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const OPEN_STATUSES = ["open", "pending", "on_hold", "reopened"];

/* --------------------------------- helpers -------------------------------- */

async function slaDueAt(tenantId, priority, from = new Date()) {
  const brand = await getCurrentBrand(tenantId);
  const baseHours = brand.settings?.slaHours || 48;
  const factor = PRIORITY_SLA_FACTOR[priority] ?? 1;
  return new Date(from.getTime() + baseHours * factor * 3_600_000);
}

async function resolveMentions(tenantId, mentions = []) {
  if (!Array.isArray(mentions) || mentions.length === 0) return [];
  const ids = mentions.filter((m) => /^[a-f\d]{24}$/i.test(String(m))).map(oid);
  if (ids.length === 0) return [];
  const users = await User.find({
    _id: { $in: ids },
    "memberships.organization": tenantId,
    status: "active",
  }).select("_id");
  return users.map((u) => u._id);
}

async function touch(ticket) {
  ticket.lastActivityAt = new Date();
  await ticket.save();
}

/**
 * Write an immutable timeline entry and fan out @mention notifications.
 * The single source of truth for appending to a ticket.
 */
async function appendUpdate(ticket, actor, data) {
  const entry = await TicketUpdate.create({
    tenantId: ticket.tenantId,
    ticket: ticket._id,
    type: data.type,
    body: data.body || "",
    visibility: data.visibility || (data.type === "customer_update" || data.type === "staff_update" ? "customer" : "internal"),
    author: data.system ? undefined : actor?.userId,
    authorName: data.system ? undefined : actor?.name,
    system: Boolean(data.system),
    sourceSystem: data.sourceSystem,
    mentions: data.mentions || [],
    attachments: data.attachments || [],
    change: data.change,
  });

  ticket.updateCount += 1;
  ticket.lastActivityAt = new Date();
  if (!ticket.firstResponseAt && !data.system && ["staff_update", "customer_update"].includes(data.type) && actor) {
    // first staff touch counts as first response
    if (data.type === "staff_update") ticket.firstResponseAt = new Date();
  }
  await ticket.save();

  // @mention notifications
  for (const uid of entry.mentions) {
    if (actor && String(uid) === String(actor.userId)) continue;
    await notify(ticket.tenantId, {
      to: { user: uid },
      type: "general",
      title: `You were mentioned on ${ticket.ticketNumber}`,
      body: `${actor?.name || "System"}: ${truncate(entry.body, 120)}`,
      link: `/crm/tickets/${ticket._id}`,
    });
  }
  // watcher + assignee notifications for customer-visible activity
  const recipients = new Set([...(ticket.watchers || []).map(String)]);
  if (ticket.assignee) recipients.add(String(ticket.assignee));
  if (actor) recipients.delete(String(actor.userId));
  for (const uid of recipients) {
    if (entry.mentions.some((m) => String(m) === uid)) continue;
    await notify(ticket.tenantId, {
      to: { user: uid },
      type: "general",
      title: `Activity on ${ticket.ticketNumber}`,
      body: truncate(entry.body || data.type.replace(/_/g, " "), 120),
      link: `/crm/tickets/${ticket._id}`,
    });
  }

  return entry;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* --------------------------------- create -------------------------------- */

export async function createTicket(tenantId, actor, input) {
  const brand = await getCurrentBrand(tenantId);
  const prefix = brand.settings?.ticketPrefix || "TKT";

  let customer = null;
  if (input.customer) {
    customer = await Customer.findOne({ _id: input.customer, tenantId });
    if (!customer) throw AppError.badRequest("Unknown customer");
  }

  const priority = input.priority || "normal";
  const ticketNumber = await nextCode(prefix, `${tenantId}:ticket`, 5);

  const ticket = await Ticket.create({
    tenantId,
    ticketNumber,
    subject: input.subject,
    customer: customer?._id,
    customerSnapshot: customer
      ? { name: customer.displayName, phone: customer.primaryPhone, email: customer.primaryEmail }
      : {},
    category: input.category || "general",
    priority,
    channel: input.channel || "web",
    status: "open",
    assignee: input.assignee ? oid(input.assignee) : undefined,
    assignedTeam: input.assignedTeam,
    tags: Array.isArray(input.tags) ? input.tags : [],
    related: input.related,
    dueAt: await slaDueAt(tenantId, priority),
    createdBy: actor.userId,
    watchers: [actor.userId],
  });

  if (ticket.assignee) {
    const u = await User.findById(ticket.assignee).select("name");
    ticket.assigneeName = u?.name;
    await ticket.save();
  }

  // Opening description becomes the first timeline entry.
  await appendUpdate(ticket, actor, {
    type: input.fromCustomer ? "customer_update" : "staff_update",
    body: input.description || input.subject,
    visibility: "customer",
    mentions: await resolveMentions(tenantId, input.mentions),
    attachments: input.attachments,
  });

  if (customer) {
    await customerService.bumpStats(tenantId, customer._id, { tickets: 1 });
    await customerService.linkExternalRef(tenantId, customer._id, {
      system: "ticket",
      ref: ticketNumber,
      recordId: ticket._id,
    });
  }
  if (ticket.assignee && String(ticket.assignee) !== String(actor.userId)) {
    await notify(tenantId, {
      to: { user: ticket.assignee },
      type: "general",
      title: `Ticket ${ticketNumber} assigned to you`,
      body: ticket.subject,
      link: `/crm/tickets/${ticket._id}`,
    });
  }

  return getTicket(tenantId, ticket._id);
}

/* ---------------------------------- reads -------------------------------- */

export async function listTickets(tenantId, actor, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };

  if (query.status) filter.status = query.status;
  else if (query.open === "true") filter.status = { $in: OPEN_STATUSES };
  if (query.priority) filter.priority = query.priority;
  if (query.category) filter.category = query.category;
  if (query.customer) filter.customer = oid(query.customer);
  if (query.channel) filter.channel = query.channel;
  if (query.tag) filter.tags = query.tag;
  if (query.escalated === "true") filter.escalated = true;
  if (query.overdue === "true") {
    filter.dueAt = { $lt: new Date() };
    filter.status = { $in: OPEN_STATUSES };
  }
  if (query.unassigned === "true") filter.assignee = { $exists: false };
  if (query.mine === "true") filter.assignee = oid(actor.userId);
  else if (query.assignee) filter.assignee = oid(query.assignee);

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ ticketNumber: rx }, { subject: rx }, { "customerSnapshot.name": rx }];
  }

  const sort =
    query.sort === "oldest"
      ? { createdAt: 1 }
      : query.sort === "due"
        ? { dueAt: 1 }
        : { lastActivityAt: -1 };

  const [items, total] = await Promise.all([
    Ticket.find(filter).sort(sort).skip(skip).limit(limit),
    Ticket.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getTicket(tenantId, id, { includeInternal = true } = {}) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");

  const updateFilter = { tenantId, ticket: ticket._id };
  if (!includeInternal) updateFilter.visibility = "customer";
  const updates = await TicketUpdate.find(updateFilter).sort({ createdAt: 1 });

  let customer = null;
  if (ticket.customer) {
    customer = await Customer.findOne({ _id: ticket.customer, tenantId }).select(
      "customerId firstName lastName businessName type emails phones stats",
    );
  }

  return { ...ticket.toJSON(), updates: updates.map((u) => u.toJSON()), customer: customer ? customer.toJSON() : null };
}

export async function ticketStats(tenantId, actor) {
  const t = oid(tenantId);
  const [byStatus, byPriority, overdue, unassigned, mine] = await Promise.all([
    Ticket.aggregate([{ $match: { tenantId: t } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Ticket.aggregate([
      { $match: { tenantId: t, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: "$priority", n: { $sum: 1 } } },
    ]),
    Ticket.countDocuments({ tenantId: t, status: { $in: OPEN_STATUSES }, dueAt: { $lt: new Date() } }),
    Ticket.countDocuments({ tenantId: t, status: { $in: OPEN_STATUSES }, assignee: { $exists: false } }),
    Ticket.countDocuments({ tenantId: t, status: { $in: OPEN_STATUSES }, assignee: oid(actor.userId) }),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
    byPriority: Object.fromEntries(byPriority.map((r) => [r._id, r.n])),
    open: byStatus.filter((r) => OPEN_STATUSES.includes(r._id)).reduce((s, r) => s + r.n, 0),
    overdue,
    unassigned,
    assignedToMe: mine,
  };
}

/* -------------------------------- mutations ------------------------------ */

export async function addUpdate(tenantId, actor, id, input) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");
  if (ticket.status === "closed") {
    throw AppError.badRequest("This ticket is closed — reopen it to add updates");
  }

  const type = input.type || "staff_update";
  if (!["staff_update", "internal_note", "customer_update"].includes(type)) {
    throw AppError.badRequest("Unsupported update type");
  }

  const entry = await appendUpdate(ticket, actor, {
    type,
    body: input.body,
    visibility: type === "internal_note" ? "internal" : "customer",
    mentions: await resolveMentions(tenantId, input.mentions),
    attachments: input.attachments,
  });

  // A staff reply on a pending ticket moves it back to open.
  if (type !== "internal_note" && ticket.status === "pending") {
    await applyStatus(ticket, actor, "open", "Staff replied");
  }
  return { ...entry.toJSON(), ticketStatus: ticket.status };
}

export async function assign(tenantId, actor, id, { assignee, team }) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");

  let name = null;
  if (assignee) {
    const user = await User.findOne({ _id: assignee, "memberships.organization": tenantId }).select("name");
    if (!user) throw AppError.badRequest("That user is not in this organization");
    name = user.name;
  }

  const fromLabel = ticket.assigneeName || ticket.assignedTeam || "Unassigned";
  ticket.assignee = assignee ? oid(assignee) : undefined;
  ticket.assigneeName = name || undefined;
  ticket.assignedTeam = team || (assignee ? undefined : ticket.assignedTeam);
  if (assignee && !ticket.watchers.some((w) => String(w) === String(assignee))) {
    ticket.watchers.push(oid(assignee));
  }
  await ticket.save();

  await appendUpdate(ticket, actor, {
    type: "assignment",
    body: `Reassigned from ${fromLabel} to ${name || team || "Unassigned"}`,
    change: { field: "assignee", from: fromLabel, to: name || team || null },
  });

  if (assignee && String(assignee) !== String(actor.userId)) {
    await notify(tenantId, {
      to: { user: assignee },
      type: "general",
      title: `Ticket ${ticket.ticketNumber} assigned to you`,
      body: ticket.subject,
      link: `/crm/tickets/${ticket._id}`,
    });
  }
  return getTicket(tenantId, ticket._id);
}

async function applyStatus(ticket, actor, status, note) {
  const from = ticket.status;
  if (from === status) return ticket;
  ticket.status = status;
  if (status === "resolved") ticket.resolvedAt = new Date();
  if (status === "closed") ticket.closedAt = new Date();
  if (status === "reopened") {
    ticket.reopenedCount += 1;
    ticket.resolvedAt = undefined;
    ticket.closedAt = undefined;
  }
  await ticket.save();
  await appendUpdate(ticket, actor, {
    type: "status_change",
    body: note || `Status changed from ${from} to ${status}`,
    change: { field: "status", from, to: status },
  });
  return ticket;
}

export async function changeStatus(tenantId, actor, id, { status, note }) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");
  const allowed = {
    open: ["pending", "on_hold", "resolved", "closed"],
    pending: ["open", "on_hold", "resolved", "closed"],
    on_hold: ["open", "pending", "resolved", "closed"],
    reopened: ["pending", "on_hold", "resolved", "closed"],
    resolved: ["closed", "reopened"],
    closed: ["reopened"],
  };
  if (!allowed[ticket.status]?.includes(status)) {
    throw AppError.badRequest(`Cannot move a ${ticket.status} ticket to ${status}`);
  }
  await applyStatus(ticket, actor, status, note);
  return getTicket(tenantId, ticket._id);
}

export async function changePriority(tenantId, actor, id, { priority, note }) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");
  const from = ticket.priority;
  if (from === priority) return getTicket(tenantId, ticket._id);
  ticket.priority = priority;
  if (ticket.isOpen) ticket.dueAt = await slaDueAt(tenantId, priority, ticket.createdAt);
  ticket.slaBreached = ticket.dueAt < new Date();
  await ticket.save();
  await appendUpdate(ticket, actor, {
    type: "priority_change",
    body: note || `Priority changed from ${from} to ${priority}`,
    change: { field: "priority", from, to: priority },
  });
  return getTicket(tenantId, ticket._id);
}

export async function escalate(tenantId, actor, id, { reason, to }) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");
  ticket.escalated = true;
  ticket.escalatedAt = new Date();
  const bump = { low: "normal", normal: "high", high: "urgent", urgent: "urgent" }[ticket.priority];
  const fromP = ticket.priority;
  ticket.priority = bump;
  if (ticket.isOpen) ticket.dueAt = await slaDueAt(tenantId, bump, new Date());
  if (to && !ticket.watchers.some((w) => String(w) === String(to))) ticket.watchers.push(oid(to));
  await ticket.save();

  await appendUpdate(ticket, actor, {
    type: "escalation",
    body: reason ? `Escalated: ${reason}` : "Ticket escalated",
    change: { field: "priority", from: fromP, to: bump },
  });

  const target = to || ticket.assignee;
  if (target && String(target) !== String(actor.userId)) {
    await notify(tenantId, {
      to: { user: target },
      type: "general",
      title: `Ticket ${ticket.ticketNumber} escalated`,
      body: reason || ticket.subject,
      link: `/crm/tickets/${ticket._id}`,
    });
  }
  return getTicket(tenantId, ticket._id);
}

export async function setDueDate(tenantId, actor, id, { dueAt }) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");
  const from = ticket.dueAt;
  ticket.dueAt = new Date(dueAt);
  ticket.slaBreached = ticket.dueAt < new Date();
  await ticket.save();
  await appendUpdate(ticket, actor, {
    type: "due_date_change",
    body: `Due date set to ${ticket.dueAt.toISOString().slice(0, 16).replace("T", " ")}`,
    change: { field: "dueAt", from, to: ticket.dueAt },
  });
  return getTicket(tenantId, ticket._id);
}

export async function toggleWatch(tenantId, actor, id, watch) {
  const ticket = await Ticket.findOne({ _id: id, tenantId });
  if (!ticket) throw AppError.notFound("Ticket not found");
  const uid = String(actor.userId);
  const has = ticket.watchers.some((w) => String(w) === uid);
  if (watch && !has) ticket.watchers.push(oid(actor.userId));
  if (!watch && has) ticket.watchers = ticket.watchers.filter((w) => String(w) !== uid);
  await touch(ticket);
  return { watching: watch };
}

/* ------------------------- system-event injection ----------------------- */

/**
 * Push an event into a ticket's timeline from another module. Either target an
 * existing ticket by number, or (with `openIfMissing`) create a lightweight
 * ticket for the customer. Used by brand modules (Phase 9) e.g. "shipment
 * delivered", "payment failed".
 */
export async function injectSystemEvent(tenantId, { ticketNumber, ticketId, customerId, sourceSystem, title, body, related, openIfMissing = false, priority = "normal" }) {
  let ticket = null;
  if (ticketId) ticket = await Ticket.findOne({ _id: ticketId, tenantId });
  else if (ticketNumber) ticket = await Ticket.findOne({ tenantId, ticketNumber });

  if (!ticket && openIfMissing) {
    const brand = await getCurrentBrand(tenantId);
    const prefix = brand.settings?.ticketPrefix || "TKT";
    const number = await nextCode(prefix, `${tenantId}:ticket`, 5);
    let customer = customerId ? await Customer.findOne({ _id: customerId, tenantId }) : null;
    ticket = await Ticket.create({
      tenantId,
      ticketNumber: number,
      subject: title,
      customer: customer?._id,
      customerSnapshot: customer
        ? { name: customer.displayName, phone: customer.primaryPhone, email: customer.primaryEmail }
        : {},
      category: "system",
      priority,
      channel: "system",
      status: "open",
      related,
      openedByType: "system",
      dueAt: await slaDueAt(tenantId, priority),
    });
    if (customer) await customerService.bumpStats(tenantId, customer._id, { tickets: 1 });
  }

  if (!ticket) return null;

  await appendUpdate(ticket, null, {
    type: "system_event",
    body: body || title,
    visibility: "internal",
    system: true,
    sourceSystem,
  });
  return ticket;
}

/* --------------------------- registry wiring --------------------------- */

// Tickets contribute to the Customer 360 timeline.
registerHistoryProvider("tickets", async (tenantId, customerId, opts = {}) => {
  const tickets = await Ticket.find({ tenantId, customer: customerId })
    .sort({ createdAt: -1 })
    .limit(opts.limit || 25);
  return tickets.map((t) => ({
    type: "ticket",
    title: `${t.ticketNumber} — ${t.subject}`,
    description: `${t.category} · ${t.priority} priority`,
    at: t.createdAt,
    status: t.status,
    link: `/crm/tickets/${t._id}`,
    meta: { ticketNumber: t.ticketNumber },
  }));
});

// A ticket number typed into global search resolves to its customer.
registerCustomerResolver("ticket", async (tenantId, term) => {
  const rx = new RegExp(`^${escapeRegex(term)}`, "i");
  const tickets = await Ticket.find({ tenantId, ticketNumber: rx, customer: { $exists: true } })
    .select("customer ticketNumber")
    .limit(10);
  return tickets.map((t) => ({ customerId: t.customer, label: `ticket ${t.ticketNumber}`, matchedOn: "ticket number" }));
});

/** SLA sweep — run from the maintenance scheduler. */
export async function sweepSla(tenantId) {
  const res = await Ticket.updateMany(
    { tenantId, status: { $in: OPEN_STATUSES }, dueAt: { $lt: new Date() }, slaBreached: false },
    { $set: { slaBreached: true } },
  );
  return res.modifiedCount;
}

export default {
  createTicket,
  listTickets,
  getTicket,
  ticketStats,
  addUpdate,
  assign,
  changeStatus,
  changePriority,
  escalate,
  setDueDate,
  toggleWatch,
  injectSystemEvent,
  sweepSla,
};
