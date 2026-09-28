import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * AJCL courier shipment. Lifecycle:
 *   created → pickup_requested → rider_assigned → picked_up → at_hub
 *   → in_transit → out_for_delivery → delivered
 *                                   ↘ failed → rescheduled (→ out_for_delivery)
 *                                            ↘ returned
 */
export const SHIPMENT_STATUSES = [
  "created",
  "pickup_requested",
  "rider_assigned",
  "picked_up",
  "at_hub",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
  "rescheduled",
  "returned",
];

export const SHIPMENT_TRANSITIONS = {
  // "at_hub" direct from "created" is for drop_off/sea_cargo shipments, which
  // skip pickup_requested/rider_assigned entirely — the sender brings the
  // parcel in (or it arrives by ship) rather than a rider collecting it.
  created: ["pickup_requested", "rider_assigned", "at_hub", "returned"],
  pickup_requested: ["rider_assigned", "returned"],
  rider_assigned: ["picked_up", "pickup_requested", "returned"],
  picked_up: ["at_hub", "in_transit", "out_for_delivery", "returned"],
  at_hub: ["in_transit", "out_for_delivery", "returned"],
  in_transit: ["at_hub", "out_for_delivery", "returned"],
  out_for_delivery: ["delivered", "failed", "returned"],
  failed: ["rescheduled", "returned"],
  rescheduled: ["out_for_delivery", "rider_assigned", "returned"],
  delivered: [],
  returned: [],
};

export const TERMINAL_STATUSES = ["delivered", "returned"];

const partySchema = new Schema(
  {
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    lga: { type: String, trim: true },
    state: { type: String, trim: true },
    landmark: { type: String, trim: true },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
  { _id: false },
);

const statusEventSchema = new Schema(
  {
    status: { type: String, required: true },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId },
    byName: { type: String, trim: true },
    location: { type: [Number], default: undefined },
    hub: { type: String, trim: true },
  },
  { _id: true },
);

const podSchema = new Schema(
  {
    recipientName: { type: String, trim: true },
    relationship: { type: String, trim: true },
    otpVerified: { type: Boolean, default: false },
    photoUrl: { type: String, trim: true },
    signatureUrl: { type: String, trim: true },
    coordinates: { type: [Number], default: undefined },
    capturedAt: { type: Date },
    capturedBy: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    trackingNumber: { type: String, required: true },
    // Set when this record was imported from the brand's own live system
    // (services/crm/externalSync.service.js) — "<source>:<their _id>".
    externalRef: { type: String, trim: true },
    reference: { type: String }, // optional client reference

    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    sender: { type: partySchema, required: true },
    recipient: { type: partySchema, required: true },

    // Parcel
    description: { type: String, trim: true },
    packageType: { type: String, enum: ["document", "parcel", "fragile", "perishable", "bulky"], default: "parcel" },
    weightKg: { type: Number, default: 0 },
    declaredValue: { type: Number, default: 0 },
    pieces: { type: Number, default: 1 },

    serviceLevel: { type: String, enum: ["standard", "express", "same_day"], default: "standard" },
    // How the shipment moves: "pickup" is a rider collecting from the sender
    // (the only kind that gets a rider assigned); "drop_off" is the sender
    // bringing the parcel to a hub themselves; "sea_cargo" travels by ship,
    // handled at the port/hub, not by a courier rider.
    fulfillmentType: { type: String, enum: ["pickup", "drop_off", "sea_cargo"], default: "pickup" },
    originHub: { type: String, trim: true },
    destinationHub: { type: String, trim: true },

    // Money
    deliveryFee: { type: Number, default: 0 },
    codAmount: { type: Number, default: 0 },
    codCollected: { type: Boolean, default: false },
    codCollectedAt: { type: Date },
    codRemittedAt: { type: Date },
    paymentStatus: { type: String, enum: ["unpaid", "paid", "cod", "waived"], default: "unpaid" },

    // Assignment (full Rider model arrives in Phase 10)
    rider: { type: Schema.Types.ObjectId, ref: "Rider" },
    riderName: { type: String, trim: true },
    riderPhone: { type: String, trim: true },

    status: { type: String, enum: SHIPMENT_STATUSES, default: "created", index: true },
    statusHistory: { type: [statusEventSchema], default: [] },
    attempts: { type: Number, default: 0 },
    lastFailureReason: { type: String, trim: true },
    expectedDeliveryDate: { type: Date },
    deliveredAt: { type: Date },

    proofOfDelivery: { type: podSchema },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

shipmentSchema.index({ tenantId: 1, trackingNumber: 1 }, { unique: true });
shipmentSchema.index({ tenantId: 1, externalRef: 1 }, { unique: true, sparse: true });
shipmentSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ tenantId: 1, rider: 1, status: 1 });
shipmentSchema.index({ tenantId: 1, "recipient.phone": 1 });

shipmentSchema.virtual("isTerminal").get(function () {
  return TERMINAL_STATUSES.includes(this.status);
});
shipmentSchema.virtual("isCod").get(function () {
  return this.codAmount > 0;
});

shipmentSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Shipment = registerModel(crmConnection, "Shipment", shipmentSchema);
export default Shipment;
