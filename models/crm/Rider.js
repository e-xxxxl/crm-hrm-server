import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const RIDER_STATUSES = ["active", "inactive", "suspended"];
export const RIDER_AVAILABILITY = ["available", "busy", "offline"];
export const VEHICLE_TYPES = ["bike", "bicycle", "car", "van", "truck", "foot"];

const locationSchema = new Schema(
  {
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
    accuracyMeters: { type: Number },
    heading: { type: Number },
    speedKph: { type: Number },
    updatedAt: { type: Date },
  },
  { _id: false },
);

const riderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    riderCode: { type: String, required: true },

    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    photoUrl: { type: String, trim: true },

    user: { type: Schema.Types.ObjectId }, // linked login (Rider role)
    employee: { type: Schema.Types.ObjectId }, // linked HRM employee, if staff

    vehicleType: { type: String, enum: VEHICLE_TYPES, default: "bike" },
    plateNumber: { type: String, trim: true },
    licenseNumber: { type: String, trim: true },
    licenseExpiry: { type: Date },

    assignedHub: { type: String, trim: true },
    zones: { type: [String], default: [] },

    guarantor: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      address: { type: String, trim: true },
    },

    status: { type: String, enum: RIDER_STATUSES, default: "active", index: true },
    availability: { type: String, enum: RIDER_AVAILABILITY, default: "offline", index: true },
    currentLocation: { type: locationSchema, default: () => ({}) },
    lastSeenAt: { type: Date },

    stats: {
      deliveries: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      activeJobs: { type: Number, default: 0 },
      codHeld: { type: Number, default: 0 },
    },
    rating: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

riderSchema.index({ tenantId: 1, riderCode: 1 }, { unique: true });
riderSchema.index({ tenantId: 1, phone: 1 });
riderSchema.index({ tenantId: 1, user: 1 }, { sparse: true });

riderSchema.virtual("successRate").get(function () {
  const total = this.stats.deliveries + this.stats.failed;
  return total > 0 ? Math.round((this.stats.deliveries / total) * 100) : null;
});

riderSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Rider = registerModel(crmConnection, "Rider", riderSchema);
export default Rider;
