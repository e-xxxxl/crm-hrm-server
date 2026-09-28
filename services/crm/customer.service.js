import mongoose from "mongoose";
import { Customer } from "../../models/crm/Customer.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, parseSort, paginated, escapeRegex } from "../../utils/query.js";
import { resolveCustomersByTerm, loadCustomerHistory, registeredHistorySources } from "./registry.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Nigerian phone → last 10 significant digits (drops +234 / leading 0). */
export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("234")) digits = digits.slice(3);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(-10);
}

function normalizeContactPoints(list, { phone = false } = {}) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const rawValue = typeof item === "string" ? item : item.value;
    if (!rawValue) continue;
    const value = phone ? normalizePhone(rawValue) : String(rawValue).toLowerCase().trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: (typeof item === "object" && item.label) || "primary",
      primary: Boolean(typeof item === "object" && item.primary),
    });
  }
  if (out.length && !out.some((c) => c.primary)) out[0].primary = true;
  return out;
}

function assertContactable(emails, phones) {
  if (emails.length === 0 && phones.length === 0) {
    throw AppError.badRequest("A customer needs at least one email or phone number");
  }
}

async function assertUnique(tenantId, emails, phones, excludeId) {
  const or = [];
  if (emails.length) or.push({ "emails.value": { $in: emails.map((e) => e.value) } });
  if (phones.length) or.push({ "phones.value": { $in: phones.map((p) => p.value) } });
  if (!or.length) return;
  const clash = await Customer.findOne({
    tenantId,
    _id: { $ne: excludeId || null },
    $or: or,
  });
  if (clash) {
    throw AppError.conflict(
      `Another customer (${clash.customerId} — ${clash.displayName}) already uses one of those contact details`,
    );
  }
}

export async function createCustomer(tenantId, actor, input) {
  const emails = normalizeContactPoints(input.emails);
  const phones = normalizeContactPoints(input.phones, { phone: true });
  assertContactable(emails, phones);
  await assertUnique(tenantId, emails, phones);

  if (input.type === "business" && !input.businessName) {
    throw AppError.badRequest("A business customer needs a business name");
  }
  if (input.type !== "business" && !input.firstName && !input.lastName) {
    throw AppError.badRequest("An individual customer needs a first or last name");
  }

  const customerId = await nextCode("CUS", `${tenantId}:customer`, 5);

  const customer = await Customer.create({
    tenantId,
    customerId,
    type: input.type || "individual",
    firstName: input.firstName,
    lastName: input.lastName,
    businessName: input.businessName,
    rcNumber: input.rcNumber,
    gender: input.gender || "",
    dateOfBirth: input.dateOfBirth,
    emails,
    phones,
    addresses: normalizeAddresses(input.addresses),
    source: input.source || "direct",
    segment: input.segment,
    tags: dedupeTags(input.tags),
    owner: input.owner ? oid(input.owner) : actor.userId,
    ownerName: input.ownerName || actor.name,
    consent: {
      marketingEmail: Boolean(input.consent?.marketingEmail),
      marketingSms: Boolean(input.consent?.marketingSms),
    },
    metadata: input.metadata,
  });
  return customer;
}

export async function updateCustomer(tenantId, id, input) {
  const customer = await Customer.findOne({ _id: id, tenantId });
  if (!customer) throw AppError.notFound("Customer not found");

  if (input.emails !== undefined) {
    customer.emails = normalizeContactPoints(input.emails);
  }
  if (input.phones !== undefined) {
    customer.phones = normalizeContactPoints(input.phones, { phone: true });
  }
  assertContactable(customer.emails, customer.phones);
  await assertUnique(tenantId, customer.emails, customer.phones, customer._id);

  const simple = ["type", "firstName", "lastName", "businessName", "rcNumber", "gender", "dateOfBirth", "source", "segment", "ownerName"];
  for (const key of simple) if (input[key] !== undefined) customer[key] = input[key];
  if (input.owner !== undefined) customer.owner = input.owner ? oid(input.owner) : undefined;
  if (input.tags !== undefined) customer.tags = dedupeTags(input.tags);
  if (input.addresses !== undefined) customer.addresses = normalizeAddresses(input.addresses);
  if (input.consent) {
    customer.consent.marketingEmail = Boolean(input.consent.marketingEmail);
    customer.consent.marketingSms = Boolean(input.consent.marketingSms);
  }
  if (input.metadata !== undefined) customer.metadata = input.metadata;

  await customer.save();
  return customer;
}

export async function getCustomer(tenantId, id) {
  const customer = await Customer.findOne({ _id: id, tenantId });
  if (!customer) throw AppError.notFound("Customer not found");
  return customer;
}

export async function listCustomers(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(
    query.sort,
    ["createdAt", "updatedAt", "firstName", "lastName", "businessName"],
    { createdAt: -1 },
  );

  const filter = { tenantId: oid(tenantId) };
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.owner) filter.owner = oid(query.owner);
  if (query.segment) filter.segment = query.segment;
  if (query.tag) filter.tags = query.tag;
  if (query.search) {
    const term = String(query.search).trim();
    const rx = new RegExp(escapeRegex(term), "i");
    const phone = normalizePhone(term);
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { businessName: rx },
      { customerId: rx },
      { "emails.value": rx },
      ...(phone ? [{ "phones.value": phone }] : []),
    ];
  }

  const [items, total] = await Promise.all([
    Customer.find(filter).sort(sort).skip(skip).limit(limit),
    Customer.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

/** Distinct, non-empty segment values in use for this tenant (e.g. "Customer", "Service Provider"). */
export async function listSegments(tenantId) {
  const values = await Customer.distinct("segment", { tenantId: oid(tenantId), segment: { $nin: [null, ""] } });
  return values.sort();
}

/**
 * Unified search across name, phone, email, customer id, and — via registered
 * brand-module resolvers — order and tracking numbers.
 */
export async function search(tenantId, term) {
  const clean = String(term || "").trim();
  if (clean.length < 2) return { term: clean, results: [] };

  const rx = new RegExp(escapeRegex(clean), "i");
  const phone = normalizePhone(clean);
  const direct = await Customer.find({
    tenantId,
    $or: [
      { customerId: rx },
      { firstName: rx },
      { lastName: rx },
      { businessName: rx },
      { "emails.value": rx },
      ...(phone.length >= 6 ? [{ "phones.value": { $regex: `${phone}$` } }] : []),
      { "externalRefs.ref": rx },
    ],
  }).limit(25);

  const results = direct.map((c) => ({
    id: c._id,
    customerId: c.customerId,
    name: c.displayName,
    type: c.type,
    email: c.primaryEmail,
    phone: c.primaryPhone,
    status: c.status,
    matchedOn: matchReason(c, { clean, rx, phone }),
  }));
  const known = new Set(results.map((r) => String(r.id)));

  // Brand-module resolvers (order no / tracking no → customer).
  const resolved = await resolveCustomersByTerm(tenantId, clean);
  for (const hit of resolved) {
    if (!hit.customerId || known.has(String(hit.customerId))) continue;
    const c = await Customer.findOne({ _id: hit.customerId, tenantId });
    if (!c) continue;
    known.add(String(c._id));
    results.push({
      id: c._id,
      customerId: c.customerId,
      name: c.displayName,
      type: c.type,
      email: c.primaryEmail,
      phone: c.primaryPhone,
      status: c.status,
      matchedOn: hit.matchedOn || hit.label || "reference",
    });
  }

  return { term: clean, results };
}

function matchReason(c, { rx, phone }) {
  if (rx.test(c.customerId)) return "customer id";
  if ((c.emails || []).some((e) => rx.test(e.value))) return "email";
  if (phone && (c.phones || []).some((p) => p.value.endsWith(phone))) return "phone";
  if ((c.externalRefs || []).some((r) => rx.test(r.ref))) return "reference";
  return "name";
}

export async function getCustomer360(tenantId, id, opts = {}) {
  const customer = await getCustomer(tenantId, id);
  const history = await loadCustomerHistory(tenantId, String(customer._id), opts);
  return {
    customer: customer.toJSON(),
    stats: customer.stats,
    history,
    historySources: registeredHistorySources(),
  };
}

export async function addNote(tenantId, actor, id, body) {
  const customer = await Customer.findOneAndUpdate(
    { _id: id, tenantId },
    { $push: { notes: { body, by: actor.userId, byName: actor.name, at: new Date() } } },
    { new: true },
  );
  if (!customer) throw AppError.notFound("Customer not found");
  return customer;
}

export async function setStatus(tenantId, id, status, reason) {
  const customer = await Customer.findOne({ _id: id, tenantId });
  if (!customer) throw AppError.notFound("Customer not found");
  customer.status = status;
  customer.blockReason = status === "blocked" ? reason || "" : "";
  await customer.save();
  return customer;
}

/* -------- helpers used by brand modules (Phase 9+) -------- */

export async function linkExternalRef(tenantId, customerId, { system, ref, recordId }) {
  await Customer.updateOne(
    { _id: customerId, tenantId, "externalRefs.ref": { $ne: ref } },
    { $push: { externalRefs: { system, ref, recordId } } },
  );
}

export async function bumpStats(tenantId, customerId, delta = {}) {
  const inc = {};
  for (const [k, v] of Object.entries(delta)) inc[`stats.${k}`] = v;
  await Customer.updateOne(
    { _id: customerId, tenantId },
    { $inc: inc, $set: { "stats.lastActivityAt": new Date() } },
  );
}

/* -------- internal -------- */

function dedupeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
}

function normalizeAddresses(addresses) {
  if (!Array.isArray(addresses)) return [];
  const out = addresses.map((a) => ({ ...a }));
  if (out.length && !out.some((a) => a.isDefault)) out[0].isDefault = true;
  return out;
}

export default {
  normalizePhone,
  createCustomer,
  updateCustomer,
  getCustomer,
  listCustomers,
  listSegments,
  search,
  getCustomer360,
  addNote,
  setStatus,
  linkExternalRef,
  bumpStats,
};
