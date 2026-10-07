import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * QuickShipAfrica shipping order. Simpler than an AJCL shipment — the customer
 * books a delivery, gets a quote, pays, and receives a tracking number. The
 * physical movement, once dispatched, mirrors the shipment status set.
 */
export const ORDER_STATUSES = [
  "draft",
  "quoted",
  "confirmed",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
];

export const ORDER_TRANSITIONS = {
  draft: ["quoted", "cancelled"],
  quoted: ["confirmed", "cancelled"],
  confirmed: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "returned"],
  in_transit: ["out_for_delivery", "returned"],
  out_for_delivery: ["delivered", "returned"],
  delivered: [],
  cancelled: [],
  returned: [],
};

const partySchema = new Schema(
  {
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    coordinates: { type: [Number], default: undefined },
  },
  { _id: false },
);

const statusEventSchema = new Schema(
  {
    status: { type: String, required: true },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now },
    byName: { type: String, trim: true },
  },
  { _id: true },
);

const orderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderNumber: { type: String, required: true },
    trackingNumber: { type: String },
    externalRef: { type: String, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    pickup: { type: partySchema, required: true },
    dropoff: { type: partySchema, required: true },

    deliveryType: { type: String, enum: ["standard", "express", "same_day", "scheduled"], default: "standard" },
    scheduledFor: { type: Date },

    package: {
      category: { type: String, trim: true, default: "general" },
      description: { type: String, trim: true },
      weightKg: { type: Number, default: 0 },
      quantity: { type: Number, default: 1 },
      value: { type: Number, default: 0 },
      fragile: { type: Boolean, default: false },
    },

    // Quote breakdown
    quote: {
      distanceKm: { type: Number, default: 0 },
      baseFare: { type: Number, default: 0 },
      distanceCharge: { type: Number, default: 0 },
      weightCharge: { type: Number, default: 0 },
      expressSurcharge: { type: Number, default: 0 },
      insurance: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      quotedAt: { type: Date },
      expiresAt: { type: Date },
    },

    paymentStatus: { type: String, enum: ["pending", "paid", "cod", "failed", "refunded"], default: "pending" },
    paymentMethod: { type: String, enum: ["card", "transfer", "wallet", "cash", "cod"], default: "transfer" },
    paidAt: { type: Date },

    status: { type: String, enum: ORDER_STATUSES, default: "draft", index: true },
    statusHistory: { type: [statusEventSchema], default: [] },
    deliveredAt: { type: Date },
    cancelReason: { type: String, trim: true },

    rider: { type: Schema.Types.ObjectId, ref: "Rider" },
    riderName: { type: String, trim: true },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

orderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, trackingNumber: 1 }, { sparse: true });
orderSchema.index({ tenantId: 1, externalRef: 1 }, { unique: true, partialFilterExpression: { externalRef: { $type: "string" } } });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

orderSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Order = registerModel(crmConnection, "Order", orderSchema);
export default Order;
