import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * 9jaTradiesPages home-services business listing. Goes through an approval
 * workflow before it is publicly visible, then carries a subscription.
 */
export const BUSINESS_STATUSES = ["pending", "approved", "rejected", "suspended"];
export const SUBSCRIPTION_TIERS = ["free", "basic", "premium", "featured"];

const subscriptionSchema = new Schema(
  {
    tier: { type: String, enum: SUBSCRIPTION_TIERS, default: "free" },
    status: { type: String, enum: ["active", "expired", "cancelled", "none"], default: "none" },
    startedAt: { type: Date },
    expiresAt: { type: Date },
    amount: { type: Number, default: 0 },
    autoRenew: { type: Boolean, default: false },
  },
  { _id: false },
);

const reviewLogSchema = new Schema(
  {
    action: { type: String, enum: ["submitted", "approved", "rejected", "suspended", "reinstated", "resubmitted"] },
    by: { type: Schema.Types.ObjectId },
    byName: { type: String, trim: true },
    reason: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const businessSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    businessCode: { type: String, required: true },
    externalRef: { type: String, trim: true },

    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true },
    owner: { type: Schema.Types.ObjectId, ref: "Customer" }, // the tradesperson as a CRM customer
    ownerName: { type: String, trim: true },

    category: { type: String, required: true, trim: true }, // "Plumbing", "Electrical", …
    services: { type: [String], default: [] },
    description: { type: String, trim: true },

    phone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    lga: { type: String, trim: true },
    state: { type: String, trim: true },
    serviceAreas: { type: [String], default: [] },
    coordinates: { type: [Number], default: undefined },

    ninNumber: { type: String, trim: true }, // National Identity Number — individual tradespeople, not a CAC-registered company
    identityVerified: { type: Boolean, default: false },
    documents: {
      type: [
        new Schema(
          { label: String, url: String, uploadedAt: { type: Date, default: Date.now } },
          { _id: false },
        ),
      ],
      default: [],
    },

    status: { type: String, enum: BUSINESS_STATUSES, default: "pending", index: true },
    reviewLog: { type: [reviewLogSchema], default: [] },
    rejectionReason: { type: String, trim: true },

    subscription: { type: subscriptionSchema, default: () => ({}) },

    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    leadsCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

businessSchema.index({ tenantId: 1, businessCode: 1 }, { unique: true });
businessSchema.index({ tenantId: 1, externalRef: 1 }, { unique: true, sparse: true });
businessSchema.index({ tenantId: 1, status: 1 });
businessSchema.index({ tenantId: 1, category: 1, state: 1 });
businessSchema.index({ name: "text", description: "text", services: "text" }, { name: "business_text" });

businessSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Business = registerModel(crmConnection, "Business", businessSchema);
export default Business;
