import mongoose from "mongoose";
import { Rider } from "../../models/crm/Rider.js";
import { Shipment, TERMINAL_STATUSES } from "../../models/crm/Shipment.js";
import { Order } from "../../models/crm/Order.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import crypto from "node:crypto";
import { haversineMeters } from "../../utils/geo.js";
import { getCurrentBrand } from "./brand.service.js";
import { User } from "../../models/hrm/User.js";
import * as shipmentService from "./shipment.service.js";
import * as orderService from "./order.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/* ============================ Rider directory ============================ */

export async function createRider(tenantId, actor, input) {
  const dup = await Rider.findOne({ tenantId, phone: input.phone });
  if (dup) throw AppError.conflict("A rider with that phone already exists");
  const riderCode = await nextCode("RID", `${tenantId}:rider`, 4);
  const rider = await Rider.create({
    tenantId,
    riderCode,
    name: input.name,
    phone: input.phone,
    email: input.email,
    user: input.user ? oid(input.user) : undefined,
    employee: input.employee ? oid(input.employee) : undefined,
    vehicleType: input.vehicleType || "bike",
    plateNumber: input.plateNumber,
    licenseNumber: input.licenseNumber,
    licenseExpiry: input.licenseExpiry,
    assignedHub: input.assignedHub,
    zones: input.zones || [],
    guarantor: input.guarantor,
    status: "active",
    createdBy: actor.userId,
  });

  let login = null;
  if (input.provisionLogin) {
    login = await provisionRiderLogin(tenantId, rider, input.provisionLogin);
  }
  return { rider, login };
}

/** Give a rider a Rider-role platform login for the PWA. `riderRef` is an id or a doc. */
export async function provisionRiderLogin(tenantId, riderRef, { password } = {}) {
  const rider =
    riderRef && typeof riderRef.save === "function"
      ? riderRef
      : await Rider.findOne({ _id: riderRef?._id || riderRef, tenantId });
  if (!rider) throw AppError.notFound("Rider not found");
  if (!rider.email) throw AppError.badRequest("Add an email to the rider before provisioning a login");
  let user = await User.findOne({ email: rider.email.toLowerCase() }).select("+passwordHash");
  const temp = password || crypto.randomBytes(9).toString("base64url");

  if (!user) {
    user = new User({
      name: rider.name,
      email: rider.email.toLowerCase(),
      phone: rider.phone,
      memberships: [{ organization: tenantId, role: "Rider", status: "active", isPrimary: true }],
    });
    await user.setPassword(temp);
    user.mustChangePassword = true;
    await user.save();
  } else if (!user.membershipFor(tenantId)) {
    user.memberships.push({ organization: tenantId, role: "Rider", status: "active" });
    await user.save();
  }
  rider.user = user._id;
  await rider.save();
  return { userId: user._id, email: user.email, tempPassword: user.mustChangePassword ? temp : null };
}

export async function listRiders(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };
  if (query.status) filter.status = query.status;
  if (query.availability) filter.availability = query.availability;
  if (query.hub) filter.assignedHub = query.hub;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { riderCode: rx }, { plateNumber: rx }];
  }
  const [items, total] = await Promise.all([
    Rider.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    Rider.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getRider(tenantId, id) {
  const rider = await Rider.findOne({ _id: id, tenantId });
  if (!rider) throw AppError.notFound("Rider not found");
  const activeJobs = await liveActiveJobs(tenantId, rider._id);
  const json = rider.toJSON();
  json.stats = { ...json.stats, activeJobs };
  return json;
}

async function liveActiveJobs(tenantId, riderId) {
  const { Model, kind } = await jobModel(tenantId);
  return Model.countDocuments({
    tenantId,
    rider: riderId,
    status: kind === "shipment" ? { $nin: TERMINAL_STATUSES } : { $nin: ["delivered", "cancelled", "returned"] },
  });
}

export async function updateRider(tenantId, id, input) {
  const rider = await Rider.findOne({ _id: id, tenantId });
  if (!rider) throw AppError.notFound("Rider not found");
  const editable = ["name", "phone", "email", "vehicleType", "plateNumber", "licenseNumber", "licenseExpiry", "assignedHub", "zones", "guarantor", "status", "user", "employee"];
  for (const k of editable) if (input[k] !== undefined) rider[k] = input[k];
  await rider.save();
  return rider;
}

/* ============================ Rider PWA side ============================ */

async function jobModel(tenantId) {
  const brand = await getCurrentBrand(tenantId);
  return brand.kind === "logistics" ? { Model: Order, kind: "order", service: orderService } : { Model: Shipment, kind: "shipment", service: shipmentService };
}

/** The Rider document for the signed-in user. */
export async function selfRider(tenantId, userId) {
  const rider = await Rider.findOne({ tenantId, user: userId });
  if (!rider) {
    throw AppError.badRequest("Your login is not linked to a rider profile. Ask dispatch to set this up.");
  }
  return rider;
}

export async function riderDashboard(tenantId, userId) {
  const rider = await selfRider(tenantId, userId);
  const { Model, kind } = await jobModel(tenantId);
  const jobs = await Model.find({
    tenantId,
    rider: rider._id,
    status: { $nin: kind === "shipment" ? TERMINAL_STATUSES : ["delivered", "cancelled", "returned"] },
  }).sort({ createdAt: 1 });

  return {
    rider: rider.toJSON(),
    jobs: jobs.map((j) => shapeJob(j, kind)),
    summary: {
      assigned: jobs.length,
      pickups: jobs.filter((j) => ["rider_assigned", "confirmed", "created", "pickup_requested"].includes(j.status)).length,
      deliveries: jobs.filter((j) => ["out_for_delivery", "in_transit", "at_hub", "picked_up"].includes(j.status)).length,
    },
  };
}

export async function riderJob(tenantId, userId, jobId) {
  const rider = await selfRider(tenantId, userId);
  const { Model, kind } = await jobModel(tenantId);
  const job = await Model.findOne({ _id: jobId, tenantId, rider: rider._id });
  if (!job) throw AppError.notFound("Job not found or not assigned to you");
  return shapeJob(job, kind, true);
}

function shapeJob(j, kind, full = false) {
  if (kind === "shipment") {
    return {
      id: j._id,
      kind,
      number: j.trackingNumber,
      status: j.status,
      priority: j.serviceLevel === "same_day" ? "urgent" : j.serviceLevel === "express" ? "high" : "normal",
      pickup: j.sender,
      dropoff: j.recipient,
      codAmount: j.codAmount,
      codCollected: j.codCollected,
      description: j.description,
      expectedDeliveryDate: j.expectedDeliveryDate,
      attempts: j.attempts,
      ...(full ? { statusHistory: j.statusHistory } : {}),
    };
  }
  return {
    id: j._id,
    kind,
    number: j.orderNumber,
    status: j.status,
    priority: j.deliveryType === "same_day" ? "urgent" : j.deliveryType === "express" ? "high" : "normal",
    pickup: j.pickup,
    dropoff: j.dropoff,
    codAmount: j.paymentMethod === "cod" ? j.quote?.total : 0,
    description: j.package?.description,
    ...(full ? { statusHistory: j.statusHistory } : {}),
  };
}

/** Rider action → underlying job status transition. */
export async function riderAction(tenantId, userId, jobId, action, payload = {}) {
  const rider = await selfRider(tenantId, userId);
  const { Model, kind, service } = await jobModel(tenantId);
  const job = await Model.findOne({ _id: jobId, tenantId, rider: rider._id });
  if (!job) throw AppError.notFound("Job not found or not assigned to you");

  const actor = { userId, name: rider.name };
  const now = new Date();

  if (action === "accept") {
    job.statusHistory.push({ status: job.status, note: "Rider accepted job", at: now, byName: rider.name });
    await job.save();
    await Rider.updateOne({ _id: rider._id }, { $set: { availability: "busy" } });
    return shapeJob(job, kind, true);
  }

  if (action === "arrived") {
    job.statusHistory.push({ status: job.status, note: payload.at === "dropoff" ? "Arrived at delivery point" : "Arrived at pickup", at: now, byName: rider.name, location: payload.location });
    await job.save();
    return shapeJob(job, kind, true);
  }

  if (action === "picked-up") {
    const updated = kind === "shipment"
      ? await service.updateStatus(tenantId, actor, jobId, { status: "picked_up", note: "Picked up by rider", location: payload.location })
      : await service.updateStatus(tenantId, actor, jobId, { status: "picked_up", note: "Picked up by rider" });
    return shapeJob(updated, kind, true);
  }

  if (action === "out-for-delivery") {
    const target = kind === "shipment" ? "out_for_delivery" : "out_for_delivery";
    const updated = await service.updateStatus(tenantId, actor, jobId, { status: target, note: "Out for delivery" });
    return shapeJob(updated, kind, true);
  }

  if (action === "delivered") {
    if (kind === "shipment") {
      const updated = await service.capturePod(tenantId, actor, jobId, {
        recipientName: payload.recipientName,
        relationship: payload.relationship,
        otpVerified: payload.otpVerified,
        photoUrl: payload.photoUrl,
        signatureUrl: payload.signatureUrl,
        coordinates: payload.location,
        codCollected: payload.codCollected,
      });
      await bumpRiderStats(rider._id, { deliveries: 1 });
      if (updated.codAmount > 0 && updated.codCollected) {
        await Rider.updateOne({ _id: rider._id }, { $inc: { "stats.codHeld": updated.codAmount } });
      }
      return shapeJob(updated, kind, true);
    }
    const updated = await service.updateStatus(tenantId, actor, jobId, { status: "delivered", note: `Delivered — received by ${payload.recipientName || "recipient"}` });
    await bumpRiderStats(rider._id, { deliveries: 1 });
    return shapeJob(updated, kind, true);
  }

  if (action === "failed") {
    if (!payload.reason) throw AppError.badRequest("A failure reason is required");
    const target = kind === "shipment" ? "failed" : "returned";
    const updated = await service.updateStatus(tenantId, actor, jobId, { status: target, note: payload.reason, location: payload.location });
    await bumpRiderStats(rider._id, { failed: 1 });
    return shapeJob(updated, kind, true);
  }

  throw AppError.badRequest(`Unknown rider action "${action}"`);
}

async function bumpRiderStats(riderId, delta) {
  const inc = {};
  for (const [k, v] of Object.entries(delta)) inc[`stats.${k}`] = v;
  await Rider.updateOne({ _id: riderId }, { $inc: inc });
}

export async function updateLocation(tenantId, userId, input) {
  const rider = await selfRider(tenantId, userId);
  rider.currentLocation = {
    coordinates: [input.longitude, input.latitude],
    accuracyMeters: input.accuracyMeters,
    heading: input.heading,
    speedKph: input.speedKph,
    updatedAt: new Date(),
  };
  rider.lastSeenAt = new Date();
  if (input.availability) rider.availability = input.availability;
  await rider.save();
  return { ok: true, availability: rider.availability };
}

export async function setAvailability(tenantId, userId, availability) {
  const rider = await selfRider(tenantId, userId);
  rider.availability = availability;
  rider.lastSeenAt = new Date();
  await rider.save();
  return { availability };
}

/* ============================ Dispatch side ============================ */

export async function dispatchBoard(tenantId) {
  const { Model, kind } = await jobModel(tenantId);
  const activeStatuses = kind === "shipment"
    ? { $nin: TERMINAL_STATUSES }
    : { $nin: ["delivered", "cancelled", "returned"] };
  const pendingPickupStatuses = kind === "shipment"
    ? ["created", "pickup_requested"]
    : ["confirmed"];

  const [riders, pendingPickups, failed, activeJobs, activeByRider] = await Promise.all([
    Rider.find({ tenantId, status: "active" }).sort({ availability: 1, name: 1 }),
    Model.find({ tenantId, status: { $in: pendingPickupStatuses }, rider: { $exists: false } }).sort({ createdAt: 1 }).limit(50),
    Model.find({ tenantId, status: kind === "shipment" ? "failed" : "returned" }).sort({ updatedAt: -1 }).limit(50),
    Model.countDocuments({ tenantId, status: activeStatuses, rider: { $exists: true } }),
    Model.aggregate([
      { $match: { tenantId: oid(tenantId), status: activeStatuses, rider: { $exists: true } } },
      { $group: { _id: "$rider", n: { $sum: 1 } } },
    ]),
  ]);
  const activeMap = Object.fromEntries(activeByRider.map((r) => [String(r._id), r.n]));

  return {
    riders: riders.map((r) => ({
      id: r._id,
      riderCode: r.riderCode,
      name: r.name,
      phone: r.phone,
      vehicleType: r.vehicleType,
      availability: r.availability,
      activeJobs: activeMap[String(r._id)] || 0,
      successRate: r.successRate,
      lastSeenAt: r.lastSeenAt,
      location: r.currentLocation?.coordinates || null,
    })),
    available: riders.filter((r) => r.availability === "available").length,
    busy: riders.filter((r) => r.availability === "busy").length,
    offline: riders.filter((r) => r.availability === "offline").length,
    pendingPickups: pendingPickups.map((j) => shapeJob(j, kind)),
    failedDeliveries: failed.map((j) => shapeJob(j, kind)),
    activeJobs,
  };
}

export async function dispatchMap(tenantId) {
  const { Model, kind } = await jobModel(tenantId);
  const [riders, jobs] = await Promise.all([
    Rider.find({ tenantId, status: "active", "currentLocation.coordinates": { $exists: true } }).select("name riderCode availability currentLocation vehicleType"),
    Model.find({
      tenantId,
      status: kind === "shipment" ? { $nin: TERMINAL_STATUSES } : { $nin: ["delivered", "cancelled", "returned"] },
    }).limit(300),
  ]);

  const pins = [];
  for (const j of jobs) {
    const shaped = shapeJob(j, kind);
    if (shaped.pickup?.coordinates?.length === 2) {
      pins.push({ type: "pickup", jobId: j._id, number: shaped.number, status: shaped.status, coordinates: shaped.pickup.coordinates });
    }
    if (shaped.dropoff?.coordinates?.length === 2) {
      pins.push({ type: "dropoff", jobId: j._id, number: shaped.number, status: shaped.status, coordinates: shaped.dropoff.coordinates });
    }
  }

  return {
    riders: riders.map((r) => ({
      id: r._id,
      name: r.name,
      availability: r.availability,
      vehicleType: r.vehicleType,
      coordinates: r.currentLocation.coordinates,
      updatedAt: r.currentLocation.updatedAt,
    })),
    pins,
  };
}

/**
 * Nearest-neighbour route ordering for a rider's stops, with a priority nudge:
 * urgent jobs are pulled forward by shrinking their effective distance.
 */
export async function optimizeRoute(tenantId, { riderId, jobIds, start }) {
  const { Model, kind } = await jobModel(tenantId);
  const jobs = await Model.find({ tenantId, _id: { $in: jobIds } });
  if (jobs.length === 0) throw AppError.badRequest("No jobs to optimise");

  const rider = riderId ? await Rider.findOne({ _id: riderId, tenantId }) : null;
  let cursor = start ||
    rider?.currentLocation?.coordinates ||
    jobs[0][kind === "shipment" ? "sender" : "pickup"]?.coordinates ||
    [3.3792, 6.5244]; // Lagos fallback

  const PRIORITY_WEIGHT = { urgent: 0.5, high: 0.75, normal: 1 };
  const stops = jobs.map((j) => {
    const shaped = shapeJob(j, kind);
    // A job that still needs pickup routes via its pickup point; otherwise dropoff.
    const needsPickup = ["created", "pickup_requested", "rider_assigned", "confirmed"].includes(j.status);
    const target = needsPickup ? shaped.pickup : shaped.dropoff;
    return {
      jobId: j._id,
      number: shaped.number,
      leg: needsPickup ? "pickup" : "dropoff",
      priority: shaped.priority,
      coordinates: target?.coordinates || null,
      address: [target?.address, target?.city, target?.state].filter(Boolean).join(", "),
    };
  });

  const ordered = [];
  const remaining = [...stops];
  let totalKm = 0;
  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = Infinity;
    remaining.forEach((s, i) => {
      if (!s.coordinates) return;
      const d = haversineMeters(cursor[1], cursor[0], s.coordinates[1], s.coordinates[0]) / 1000;
      const score = d * (PRIORITY_WEIGHT[s.priority] ?? 1);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    const [next] = remaining.splice(bestIdx, 1);
    if (next.coordinates) {
      totalKm += haversineMeters(cursor[1], cursor[0], next.coordinates[1], next.coordinates[0]) / 1000;
      cursor = next.coordinates;
    }
    ordered.push(next);
  }

  return {
    riderId: riderId || null,
    stops: ordered.map((s, i) => ({ sequence: i + 1, ...s })),
    estimatedDistanceKm: Math.round(totalKm * 10) / 10,
    estimatedMinutes: Math.round((totalKm / 20) * 60), // ~20km/h in city traffic
  };
}

/** Sync Rider.stats.activeJobs from live job counts (called after assignment). */
export async function recountActiveJobs(tenantId, riderId) {
  const { Model, kind } = await jobModel(tenantId);
  const activeJobs = await Model.countDocuments({
    tenantId,
    rider: riderId,
    status: kind === "shipment" ? { $nin: TERMINAL_STATUSES } : { $nin: ["delivered", "cancelled", "returned"] },
  });
  await Rider.updateOne({ _id: riderId, tenantId }, { $set: { "stats.activeJobs": activeJobs } });
  return activeJobs;
}

export default {
  createRider,
  provisionRiderLogin,
  listRiders,
  getRider,
  updateRider,
  selfRider,
  riderDashboard,
  riderJob,
  riderAction,
  updateLocation,
  setAvailability,
  dispatchBoard,
  dispatchMap,
  optimizeRoute,
  recountActiveJobs,
};
