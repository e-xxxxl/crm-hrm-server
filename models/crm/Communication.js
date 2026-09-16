import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const COMM_CHANNELS = ["call", "whatsapp", "sms", "email", "note", "meeting", "in_person"];
export const COMM_DIRECTIONS = ["inbound", "outbound", "internal"];

/**
 * A logged interaction with a customer. Aggregated into the Customer-360 history
 * alongside tickets, orders and shipments. Created manually by staff or pushed
 * by other modules (e.g. an outbound email).
 */
const communicationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },

    channel: { type: String, enum: COMM_CHANNELS, required: true },
    direction: { type: String, enum: COMM_DIRECTIONS, default: "outbound" },

    subject: { type: String, trim: true },
    body: { type: String, trim: true, required: true },
    occurredAt: { type: Date, default: Date.now },
    durationSeconds: { type: Number }, // for calls
    outcome: { type: String, trim: true },

    // Link to a record the conversation was about.
    relatedType: { type: String, enum: ["ticket", "lead", "shipment", "order", ""], default: "" },
    relatedId: { type: Schema.Types.ObjectId },
    relatedLabel: { type: String, trim: true },

    attachments: {
      type: [new Schema({ name: String, url: String }, { _id: false })],
      default: [],
    },

    by: { type: Schema.Types.ObjectId },
    byName: { type: String, trim: true },
    source: { type: String, trim: true, default: "manual" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

communicationSchema.index({ tenantId: 1, customer: 1, occurredAt: -1 });
communicationSchema.index({ tenantId: 1, occurredAt: -1 });

communicationSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Communication = registerModel(crmConnection, "Communication", communicationSchema);
export default Communication;
