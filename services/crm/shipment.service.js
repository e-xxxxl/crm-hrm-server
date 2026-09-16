import mongoose from "mongoose";
import { Shipment, SHIPMENT_TRANSITIONS, TERMINAL_STATUSES } from "../../models/crm/Shipment.js";
import { Customer } from "../../models/crm/Customer.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import { getCurrentBrand } from "./brand.service.js";
import { registerHistoryProvider, registerCustomerResolver } from "./registry.js";
import * as customerService from "./customer.service.js";
import { injectSystemEvent } from "./ticket.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

function statusEvent(status, actor, extra = {}) {
  return {
    status,
    note: extra.note,
    at: new Date(),
    by: actor?.userId,
    byName: actor?.name,
    location: extra.location,
    hub: extra.hub,
  };
}

async function trackingNumber(tenantId) {
  const brand = await getCurrentBrand(tenantId);
  const prefix = brand.settings?.trackingPrefix || brand.code || "SHP";
  return nextCode(prefix, `${tenantId}:shipment`, 7);
}

export async function createShipment(tenantId, actor, input) {
  let customer = null;
  if (input.customer) {
    customer = await Customer.findOne({ _id: input.customer, tenantId });
    if (!customer) throw AppError.badRequest("Unknown customer");
  }

  const tn = await trackingNumber(tenantId);
  const codAmount = input.codAmount || 0;

  const shipment = await Shipment.create({
    tenantId,
    trackingNumber: tn,
    reference: input.reference,
    customer: customer?._id,
    sender: input.sender,
    recipient: input.recipient,
    description: input.description,
    packageType: input.packageType || "parcel",
    weightKg: input.weightKg || 0,
    declaredValue: input.declaredValue || 0,
    pieces: input.pieces || 1,
    serviceLevel: input.serviceLevel || "standard",
    originHub: input.originHub,
    destinationHub: input.destinationHub,
    deliveryFee: input.deliveryFee || 0,
    codAmount,
    paymentStatus: codAmount > 0 ? "cod" : input.paymentStatus || "unpaid",
    expectedDeliveryDate: input.expectedDeliveryDate,
    status: "created",
    statusHistory: [statusEvent("created", actor, { note: "Shipment booked" })],
    createdBy: actor.userId,
  });

  if (customer) {
    await customerService.bumpStats(tenantId, customer._id, {
      shipments: 1,
      ...(codAmount > 0 ? { outstandingCod: codAmount } : {}),
    });
    await customerService.linkExternalRef(tenantId, customer._id, {
      system: "shipment",
      ref: tn,
      recordId: shipment._id,
    });
  }

  return shipment;
}

export async function listShipments(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };

  if (query.status) filter.status = query.status;
  else if (query.active === "true") filter.status = { $nin: TERMINAL_STATUSES };
  if (query.rider) filter.rider = oid(query.rider);
  if (query.unassigned === "true") filter.rider = { $exists: false };
  if (query.customer) filter.customer = oid(query.customer);
  if (query.cod === "true") filter.codAmount = { $gt: 0 };
  if (query.codOutstanding === "true") {
    filter.codAmount = { $gt: 0 };
    filter.codCollected = true;
    filter.codRemittedAt = { $exists: false };
  }
  if (query.serviceLevel) filter.serviceLevel = query.serviceLevel;
  if (query.hub) filter.$or = [{ originHub: query.hub }, { destinationHub: query.hub }];
  if (query.overdue === "true") {
    filter.expectedDeliveryDate = { $lt: new Date() };
    filter.status = { $nin: TERMINAL_STATUSES };
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ trackingNumber: rx }, { "recipient.name": rx }, { "recipient.phone": rx }, { reference: rx }];
  }

  const [items, total] = await Promise.all([
    Shipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Shipment.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getShipment(tenantId, id) {
  const shipment = await Shipment.findOne({ _id: id, tenantId });
  if (!shipment) throw AppError.notFound("Shipment not found");
  return shipment;
}

export async function trackByNumber(tenantId, trackingNo) {
  const s = await Shipment.findOne({ tenantId, trackingNumber: String(trackingNo).toUpperCase().trim() });
  if (!s) throw AppError.notFound("No shipment with that tracking number");
  return {
    trackingNumber: s.trackingNumber,
    status: s.status,
    serviceLevel: s.serviceLevel,
    origin: s.sender?.city || s.originHub,
    destination: s.recipient?.city || s.destinationHub,
    expectedDeliveryDate: s.expectedDeliveryDate,
    deliveredAt: s.deliveredAt,
    history: s.statusHistory.map((e) => ({ status: e.status, at: e.at, note: e.note, hub: e.hub })),
  };
}

export async function updateStatus(tenantId, actor, id, input) {
  const shipment = await Shipment.findOne({ _id: id, tenantId });
  if (!shipment) throw AppError.notFound("Shipment not found");

  const { status } = input;
  const allowed = SHIPMENT_TRANSITIONS[shipment.status] || [];
  if (!allowed.includes(status)) {
    throw AppError.badRequest(`Cannot move a "${shipment.status}" shipment to "${status}"`);
  }

  if (status === "delivered" && !shipment.proofOfDelivery && !input.force) {
    throw AppError.badRequest("Capture proof of delivery before marking delivered", { code: "POD_REQUIRED" });
  }

  shipment.status = status;
  shipment.statusHistory.push(statusEvent(status, actor, input));

  if (status === "failed") {
    shipment.attempts += 1;
    shipment.lastFailureReason = input.note || "Delivery attempt failed";
  }
  if (status === "rescheduled") {
    shipment.expectedDeliveryDate = input.expectedDeliveryDate
      ? new Date(input.expectedDeliveryDate)
      : new Date(Date.now() + 86400000);
  }
  if (status === "delivered") {
    shipment.deliveredAt = new Date();
    if (shipment.codAmount > 0 && !shipment.codCollected) {
      shipment.codCollected = true;
      shipment.codCollectedAt = new Date();
    }
  }
  await shipment.save();

  // Push a support event for exceptions on a customer-linked shipment.
  if (shipment.customer && (status === "returned" || (status === "failed" && shipment.attempts >= 2))) {
    await injectSystemEvent(tenantId, {
      customerId: shipment.customer,
      sourceSystem: "shipments",
      title: `Shipment ${shipment.trackingNumber} ${status}`,
      body:
        status === "returned"
          ? `Shipment to ${shipment.recipient?.name || "recipient"} was returned.`
          : `Delivery attempt ${shipment.attempts} failed: ${shipment.lastFailureReason}`,
      related: { type: "ajcl-shipment", ref: shipment.trackingNumber, recordId: shipment._id },
      openIfMissing: true,
      priority: "high",
    });
  }

  return shipment;
}

export async function assignRider(tenantId, actor, id, { riderId, riderName, riderPhone }) {
  const shipment = await Shipment.findOne({ _id: id, tenantId });
  if (!shipment) throw AppError.notFound("Shipment not found");
  if (TERMINAL_STATUSES.includes(shipment.status)) {
    throw AppError.badRequest("Shipment is already closed");
  }

  shipment.rider = riderId ? oid(riderId) : undefined;
  shipment.riderName = riderName;
  shipment.riderPhone = riderPhone;

  if (["created", "pickup_requested"].includes(shipment.status)) {
    shipment.status = "rider_assigned";
    shipment.statusHistory.push(
      statusEvent("rider_assigned", actor, { note: `Assigned to ${riderName || "rider"}` }),
    );
  } else {
    shipment.statusHistory.push({
      status: shipment.status,
      note: `Rider changed to ${riderName || "rider"}`,
      at: new Date(),
      by: actor?.userId,
      byName: actor?.name,
    });
  }
  await shipment.save();
  return shipment;
}

export async function capturePod(tenantId, actor, id, input) {
  const shipment = await Shipment.findOne({ _id: id, tenantId });
  if (!shipment) throw AppError.notFound("Shipment not found");
  if (shipment.status === "delivered") throw AppError.badRequest("Shipment already delivered");
  if (!["out_for_delivery", "in_transit", "at_hub", "picked_up"].includes(shipment.status)) {
    throw AppError.badRequest(`Cannot capture delivery for a "${shipment.status}" shipment`);
  }

  shipment.proofOfDelivery = {
    recipientName: input.recipientName,
    relationship: input.relationship,
    otpVerified: Boolean(input.otpVerified),
    photoUrl: input.photoUrl,
    signatureUrl: input.signatureUrl,
    coordinates: input.coordinates,
    capturedAt: new Date(),
    capturedBy: actor.userId,
  };
  shipment.status = "delivered";
  shipment.deliveredAt = new Date();
  shipment.statusHistory.push(statusEvent("delivered", actor, { note: `Received by ${input.recipientName}`, location: input.coordinates }));

  if (shipment.codAmount > 0 && (input.codCollected ?? true)) {
    shipment.codCollected = true;
    shipment.codCollectedAt = new Date();
  }
  await shipment.save();
  return shipment;
}

export async function remitCod(tenantId, actor, id) {
  const shipment = await Shipment.findOne({ _id: id, tenantId });
  if (!shipment) throw AppError.notFound("Shipment not found");
  if (!shipment.codCollected) throw AppError.badRequest("COD has not been collected yet");
  if (shipment.codRemittedAt) throw AppError.badRequest("COD already remitted");

  shipment.codRemittedAt = new Date();
  shipment.paymentStatus = "paid";
  shipment.statusHistory.push({
    status: shipment.status,
    note: `COD ₦${shipment.codAmount.toLocaleString()} remitted`,
    at: new Date(),
    byName: actor?.name,
  });
  await shipment.save();

  if (shipment.customer) {
    await customerService.bumpStats(tenantId, shipment.customer, { outstandingCod: -shipment.codAmount });
  }
  return shipment;
}

export async function shipmentStats(tenantId) {
  const t = oid(tenantId);
  const [byStatus, codAgg, overdue] = await Promise.all([
    Shipment.aggregate([{ $match: { tenantId: t } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Shipment.aggregate([
      { $match: { tenantId: t, codAmount: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          totalCod: { $sum: "$codAmount" },
          collected: { $sum: { $cond: ["$codCollected", "$codAmount", 0] } },
          remitted: { $sum: { $cond: [{ $gt: ["$codRemittedAt", null] }, "$codAmount", 0] } },
        },
      },
    ]),
    Shipment.countDocuments({ tenantId: t, status: { $nin: TERMINAL_STATUSES }, expectedDeliveryDate: { $lt: new Date() } }),
  ]);

  const byStatusMap = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const cod = codAgg[0] || { totalCod: 0, collected: 0, remitted: 0 };
  const active = byStatus.filter((r) => !TERMINAL_STATUSES.includes(r._id)).reduce((s, r) => s + r.n, 0);
  const delivered = byStatusMap.delivered || 0;
  const failed = byStatusMap.failed || 0;
  return {
    byStatus: byStatusMap,
    active,
    delivered,
    overdue,
    successRate: delivered + failed > 0 ? Math.round((delivered / (delivered + failed)) * 100) : null,
    cod: {
      outstanding: cod.collected - cod.remitted,
      collected: cod.collected,
      remitted: cod.remitted,
      inField: cod.totalCod - cod.collected,
    },
  };
}

/* --------------------------- registry wiring --------------------------- */

registerHistoryProvider("shipments", async (tenantId, customerId, opts = {}) => {
  const rows = await Shipment.find({ tenantId, customer: customerId })
    .sort({ createdAt: -1 })
    .limit(opts.limit || 25);
  return rows.map((s) => ({
    type: "shipment",
    title: `${s.trackingNumber} → ${s.recipient?.name || "recipient"}`,
    description: `${s.serviceLevel} · ${s.status}${s.codAmount ? ` · COD ₦${s.codAmount.toLocaleString()}` : ""}`,
    at: s.createdAt,
    status: s.status,
    amount: s.deliveryFee || undefined,
    link: `/crm/shipments/${s._id}`,
  }));
});

registerCustomerResolver("shipment", async (tenantId, term) => {
  const rx = new RegExp(`^${escapeRegex(term)}`, "i");
  const rows = await Shipment.find({ tenantId, trackingNumber: rx, customer: { $exists: true } })
    .select("customer trackingNumber")
    .limit(10);
  return rows.map((s) => ({ customerId: s.customer, label: `tracking ${s.trackingNumber}`, matchedOn: "tracking number" }));
});

export default {
  createShipment,
  listShipments,
  getShipment,
  trackByNumber,
  updateStatus,
  assignRider,
  capturePod,
  remitCod,
  shipmentStats,
};
