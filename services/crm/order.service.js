import mongoose from "mongoose";
import { Order, ORDER_TRANSITIONS } from "../../models/crm/Order.js";
import { Customer } from "../../models/crm/Customer.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import { getCurrentBrand } from "./brand.service.js";
import { registerHistoryProvider, registerCustomerResolver } from "./registry.js";
import { haversineMeters } from "../../utils/geo.js";
import * as customerService from "./customer.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Simple, transparent NGN quote. Tuned for intra-city Nigerian dispatch. */
const PRICING = {
  baseFare: 800,
  perKm: 120,
  freeKm: 3,
  perKgOver5: 150,
  expressMultiplier: 0.6, // +60% of subtotal
  sameDayMultiplier: 1.0,
  scheduledMultiplier: 0,
  insuranceRate: 0.01, // 1% of declared value
  minInsurance: 0,
};

export function quoteFor({ pickup, dropoff, weightKg = 0, deliveryType = "standard", value = 0 }) {
  let distanceKm = 0;
  if (pickup?.coordinates?.length === 2 && dropoff?.coordinates?.length === 2) {
    const [plng, plat] = pickup.coordinates;
    const [dlng, dlat] = dropoff.coordinates;
    distanceKm = Math.round((haversineMeters(plat, plng, dlat, dlng) / 1000) * 10) / 10;
  } else {
    // No coordinates — fall back to a flat intra-city assumption.
    distanceKm = pickup?.state && dropoff?.state && pickup.state !== dropoff.state ? 25 : 8;
  }

  const baseFare = PRICING.baseFare;
  const chargeableKm = Math.max(0, distanceKm - PRICING.freeKm);
  const distanceCharge = Math.round(chargeableKm * PRICING.perKm);
  const weightCharge = weightKg > 5 ? Math.round((weightKg - 5) * PRICING.perKgOver5) : 0;

  const subtotal = baseFare + distanceCharge + weightCharge;
  const mult =
    deliveryType === "express"
      ? PRICING.expressMultiplier
      : deliveryType === "same_day"
        ? PRICING.sameDayMultiplier
        : 0;
  const expressSurcharge = Math.round(subtotal * mult);
  const insurance = value > 0 ? Math.max(PRICING.minInsurance, Math.round(value * PRICING.insuranceRate)) : 0;
  const total = subtotal + expressSurcharge + insurance;

  return {
    distanceKm,
    baseFare,
    distanceCharge,
    weightCharge,
    expressSurcharge,
    insurance,
    total,
    quotedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  };
}

function statusEvent(status, actor, note) {
  return { status, note, at: new Date(), byName: actor?.name };
}

export async function createOrder(tenantId, actor, input) {
  let customer = null;
  if (input.customer) {
    customer = await Customer.findOne({ _id: input.customer, tenantId });
    if (!customer) throw AppError.badRequest("Unknown customer");
  }

  const orderNumber = await nextCode("ORD", `${tenantId}:order`, 6);
  const quote = quoteFor({
    pickup: input.pickup,
    dropoff: input.dropoff,
    weightKg: input.package?.weightKg,
    deliveryType: input.deliveryType,
    value: input.package?.value,
  });

  const order = await Order.create({
    tenantId,
    orderNumber,
    customer: customer?._id,
    pickup: input.pickup,
    dropoff: input.dropoff,
    deliveryType: input.deliveryType || "standard",
    scheduledFor: input.scheduledFor,
    package: input.package || {},
    quote,
    paymentMethod: input.paymentMethod || "transfer",
    paymentStatus: input.paymentMethod === "cod" ? "cod" : "pending",
    status: "quoted",
    statusHistory: [statusEvent("draft", actor, "Order created"), statusEvent("quoted", actor, `Quote ₦${quote.total.toLocaleString()}`)],
    createdBy: actor.userId,
  });

  if (customer) {
    await customerService.bumpStats(tenantId, customer._id, { orders: 1 });
    await customerService.linkExternalRef(tenantId, customer._id, {
      system: "order",
      ref: orderNumber,
      recordId: order._id,
    });
  }
  return order;
}

export async function requote(tenantId, id, input) {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) throw AppError.notFound("Order not found");
  if (!["draft", "quoted"].includes(order.status)) {
    throw AppError.badRequest("Only a draft or quoted order can be re-quoted");
  }
  if (input.pickup) order.pickup = input.pickup;
  if (input.dropoff) order.dropoff = input.dropoff;
  if (input.package) order.package = { ...order.package.toObject?.(), ...input.package };
  if (input.deliveryType) order.deliveryType = input.deliveryType;

  order.quote = quoteFor({
    pickup: order.pickup,
    dropoff: order.dropoff,
    weightKg: order.package?.weightKg,
    deliveryType: order.deliveryType,
    value: order.package?.value,
  });
  order.status = "quoted";
  order.statusHistory.push(statusEvent("quoted", null, `Re-quoted ₦${order.quote.total.toLocaleString()}`));
  await order.save();
  return order;
}

export async function listOrders(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };
  if (query.status) filter.status = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.customer) filter.customer = oid(query.customer);
  if (query.deliveryType) filter.deliveryType = query.deliveryType;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ orderNumber: rx }, { trackingNumber: rx }, { "dropoff.name": rx }, { "dropoff.phone": rx }];
  }
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getOrder(tenantId, id) {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) throw AppError.notFound("Order not found");
  return order;
}

export async function confirmOrder(tenantId, actor, id) {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) throw AppError.notFound("Order not found");
  if (order.status !== "quoted") throw AppError.badRequest("Order must be quoted before it can be confirmed");
  if (order.quote?.expiresAt && order.quote.expiresAt < new Date()) {
    throw AppError.badRequest("The quote has expired — re-quote before confirming");
  }

  order.status = "confirmed";
  order.trackingNumber = order.trackingNumber || (await genTracking(tenantId));
  order.statusHistory.push(statusEvent("confirmed", actor, `Tracking ${order.trackingNumber}`));
  await order.save();
  return order;
}

async function genTracking(tenantId) {
  const brand = await getCurrentBrand(tenantId);
  const prefix = brand.settings?.trackingPrefix || brand.code || "QS";
  return nextCode(prefix, `${tenantId}:order-tracking`, 7);
}

export async function recordPayment(tenantId, actor, id, { method, status }) {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) throw AppError.notFound("Order not found");
  if (method) order.paymentMethod = method;
  order.paymentStatus = status;
  if (status === "paid") order.paidAt = new Date();
  order.statusHistory.push(statusEvent(order.status, actor, `Payment ${status}${method ? ` via ${method}` : ""}`));
  await order.save();
  return order;
}

export async function updateStatus(tenantId, actor, id, { status, note }) {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) throw AppError.notFound("Order not found");
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    throw AppError.badRequest(`Cannot move a "${order.status}" order to "${status}"`);
  }
  if (status === "confirmed" && !order.trackingNumber) {
    order.trackingNumber = await genTracking(tenantId);
  }
  order.status = status;
  if (status === "delivered") order.deliveredAt = new Date();
  if (status === "cancelled") order.cancelReason = note;
  order.statusHistory.push(statusEvent(status, actor, note));
  await order.save();
  return order;
}

export async function assignRider(tenantId, actor, id, { riderId, riderName }) {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) throw AppError.notFound("Order not found");
  order.rider = riderId ? oid(riderId) : undefined;
  order.riderName = riderName;
  order.statusHistory.push(statusEvent(order.status, actor, `Rider ${riderName || "unassigned"}`));
  await order.save();
  return order;
}

export async function orderStats(tenantId) {
  const t = oid(tenantId);
  const [byStatus, byPayment, revenue] = await Promise.all([
    Order.aggregate([{ $match: { tenantId: t } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { tenantId: t } }, { $group: { _id: "$paymentStatus", n: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { tenantId: t, paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$quote.total" } } },
    ]),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n])),
    byPayment: Object.fromEntries(byPayment.map((r) => [r._id, r.n])),
    paidRevenue: revenue[0]?.total || 0,
  };
}

registerHistoryProvider("orders", async (tenantId, customerId, opts = {}) => {
  const rows = await Order.find({ tenantId, customer: customerId }).sort({ createdAt: -1 }).limit(opts.limit || 25);
  return rows.map((o) => ({
    type: "order",
    title: `${o.orderNumber} — ${o.dropoff?.name || "delivery"}`,
    description: `${o.deliveryType} · ${o.status} · ${o.paymentStatus}`,
    at: o.createdAt,
    status: o.status,
    amount: o.quote?.total,
    link: `/crm/orders/${o._id}`,
  }));
});

registerCustomerResolver("order", async (tenantId, term) => {
  const rx = new RegExp(`^${escapeRegex(term)}`, "i");
  const rows = await Order.find({
    tenantId,
    $or: [{ orderNumber: rx }, { trackingNumber: rx }],
    customer: { $exists: true },
  })
    .select("customer orderNumber")
    .limit(10);
  return rows.map((o) => ({ customerId: o.customer, label: `order ${o.orderNumber}`, matchedOn: "order number" }));
});

export default {
  quoteFor,
  createOrder,
  requote,
  listOrders,
  getOrder,
  confirmOrder,
  recordPayment,
  updateStatus,
  assignRider,
  orderStats,
};
