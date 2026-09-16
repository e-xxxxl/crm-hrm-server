import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const TICKET_STATUSES = ["open", "pending", "on_hold", "resolved", "closed", "reopened"];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];
export const TICKET_CHANNELS = ["phone", "email", "whatsapp", "walk-in", "web", "social", "system"];

/** Priority → SLA multiplier applied to the brand's default resolution hours. */
export const PRIORITY_SLA_FACTOR = { urgent: 0.25, high: 0.5, normal: 1, low: 2 };

const customerSnapshot = new Schema(
  {
    name: String,
    phone: String,
    email: String,
  },
  { _id: false },
);

const ticketSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    ticketNumber: { type: String, required: true },

    subject: { type: String, required: true, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    customerSnapshot: { type: customerSnapshot, default: () => ({}) },

    category: { type: String, trim: true, default: "general" },
    priority: { type: String, enum: TICKET_PRIORITIES, default: "normal" },
    status: { type: String, enum: TICKET_STATUSES, default: "open", index: true },
    channel: { type: String, enum: TICKET_CHANNELS, default: "web" },

    assignee: { type: Schema.Types.ObjectId, index: true }, // User
    assigneeName: { type: String, trim: true },
    assignedTeam: { type: String, trim: true }, // department / desk name
    watchers: { type: [Schema.Types.ObjectId], default: [] },

    // Link to a record in a brand module (order, shipment, …).
    related: {
      type: { type: String, trim: true }, // "quickship-order" | "ajcl-shipment" | …
      ref: { type: String, trim: true },
      recordId: { type: Schema.Types.ObjectId },
    },

    tags: { type: [String], default: [] },

    // SLA / lifecycle timestamps
    dueAt: { type: Date },
    slaBreached: { type: Boolean, default: false },
    escalated: { type: Boolean, default: false },
    escalatedAt: { type: Date },
    firstResponseAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
    reopenedCount: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now },
    updateCount: { type: Number, default: 0 },

    openedByType: { type: String, enum: ["staff", "system"], default: "staff" },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ticketSchema.index({ tenantId: 1, ticketNumber: 1 }, { unique: true });
ticketSchema.index({ tenantId: 1, status: 1, priority: 1, dueAt: 1 });
ticketSchema.index({ tenantId: 1, assignee: 1, status: 1 });
ticketSchema.index({ subject: "text" }, { name: "ticket_text" });

ticketSchema.virtual("isOpen").get(function () {
  return !["resolved", "closed"].includes(this.status);
});

ticketSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Ticket = registerModel(crmConnection, "Ticket", ticketSchema);
export default Ticket;
