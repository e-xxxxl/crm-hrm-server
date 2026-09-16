import mongoose from "mongoose";
import { ajclSourceConnection } from "../../config/externalSources.js";

/**
 * READ-ONLY mirrors of AJ Courier Logistics' own production schema
 * (see C:\Users\HP\Desktop\ajcl\backend\src\models). `strict: false` so an
 * unmapped field never breaks a read; nothing here is ever saved.
 */
const { Schema } = mongoose;

const userSchema = new Schema(
  { firstName: String, lastName: String, email: String, phone: String, role: String, createdAt: Date },
  { strict: false, collection: "users" },
);

const bookingSchema = new Schema(
  {
    bookingReference: String,
    user: Schema.Types.ObjectId,
    pickup: Schema.Types.Mixed,
    destination: Schema.Types.Mixed,
    sender: Schema.Types.Mixed,
    recipient: Schema.Types.Mixed,
    package: Schema.Types.Mixed,
    pricing: Schema.Types.Mixed,
    payment: Schema.Types.Mixed,
    status: String,
    statusHistory: [Schema.Types.Mixed],
    assignedDriver: Schema.Types.Mixed,
    scheduledAt: Date,
    deliveredAt: Date,
    createdAt: Date,
  },
  { strict: false, collection: "bookings" },
);

export const AjclUser = ajclSourceConnection?.models.User || ajclSourceConnection?.model("User", userSchema);
export const AjclBooking = ajclSourceConnection?.models.Booking || ajclSourceConnection?.model("Booking", bookingSchema);

export default { AjclUser, AjclBooking };
