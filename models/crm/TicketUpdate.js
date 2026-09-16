import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Append-only timeline entry for a ticket. Documents here are never edited or
 * deleted — corrections are added as new entries. Enforced in the service layer
 * (no update/delete routes) and by the absence of an `updatedAt` field.
 */
export const UPDATE_TYPES = [
  "staff_update", // staff-authored, customer-visible
  "internal_note", // staff-only
  "customer_update", // message from / to the customer
  "system_event", // injected by another module
  "assignment",
  "status_change",
  "priority_change",
  "escalation",
  "due_date_change",
];

const attachmentSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId },
    name: { type: String, trim: true },
    url: { type: String, trim: true },
    size: { type: Number },
    contentType: { type: String, trim: true },
  },
  { _id: false },
);

const ticketUpdateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    ticket: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },

    type: { type: String, enum: UPDATE_TYPES, required: true },
    body: { type: String, trim: true, default: "" },
    visibility: { type: String, enum: ["internal", "customer"], default: "internal" },

    author: { type: Schema.Types.ObjectId }, // User; null for system events
    authorName: { type: String, trim: true },
    system: { type: Boolean, default: false },
    sourceSystem: { type: String, trim: true }, // for system_event: which module

    mentions: { type: [Schema.Types.ObjectId], default: [] },
    attachments: { type: [attachmentSchema], default: [] },

    // For *_change entries: { field, from, to }
    change: {
      field: String,
      from: Schema.Types.Mixed,
      to: Schema.Types.Mixed,
    },

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

ticketUpdateSchema.index({ tenantId: 1, ticket: 1, createdAt: 1 });

ticketUpdateSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const TicketUpdate = registerModel(crmConnection, "TicketUpdate", ticketUpdateSchema);
export default TicketUpdate;
