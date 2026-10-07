import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Sales lead pipeline. Primary use is 9jaTradiesPages (a customer needs a
 * tradesperson), but the model is brand-neutral so QuickShip / AJCL sales can
 * use it too.
 *
 *   new → contacted → qualified → quoted → won | lost
 */
export const LEAD_STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost"];
export const LEAD_TRANSITIONS = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "quoted", "lost"],
  qualified: ["quoted", "won", "lost"],
  quoted: ["won", "lost", "qualified"],
  won: [],
  lost: ["new"],
};

const activitySchema = new Schema(
  {
    type: { type: String, enum: ["note", "call", "email", "whatsapp", "meeting", "stage_change", "quote"], default: "note" },
    body: { type: String, trim: true },
    by: { type: Schema.Types.ObjectId },
    byName: { type: String, trim: true },
    at: { type: Date, default: Date.now },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: true },
);

const leadSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    reference: { type: String, required: true },
    externalRef: { type: String, trim: true },

    // Who wants the service
    customer: { type: Schema.Types.ObjectId, ref: "Customer" },
    contactName: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true },

    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    serviceCategory: { type: String, trim: true },
    location: { type: String, trim: true },
    state: { type: String, trim: true },

    source: { type: String, trim: true, default: "web" },
    // Matched / assigned tradesperson business (9jaTradies)
    matchedBusiness: { type: Schema.Types.ObjectId, ref: "Business" },
    matchedBusinessName: { type: String, trim: true },

    owner: { type: Schema.Types.ObjectId }, // sales staff (User)
    ownerName: { type: String, trim: true },

    stage: { type: String, enum: LEAD_STAGES, default: "new", index: true },
    estimatedValue: { type: Number, default: 0 },
    quotedAmount: { type: Number, default: 0 },
    wonValue: { type: Number, default: 0 },
    lostReason: { type: String, trim: true },

    nextFollowUpAt: { type: Date },
    activities: { type: [activitySchema], default: [] },
    stageEnteredAt: { type: Date, default: Date.now },
    closedAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

leadSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
leadSchema.index({ tenantId: 1, externalRef: 1 }, { unique: true, partialFilterExpression: { externalRef: { $type: "string" } } });
leadSchema.index({ tenantId: 1, stage: 1, updatedAt: -1 });
leadSchema.index({ tenantId: 1, owner: 1, stage: 1 });

leadSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Lead = registerModel(crmConnection, "Lead", leadSchema);
export default Lead;
