import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * A customer review of a 9jaTradiesPages business. Goes through moderation
 * before it counts toward the business rating.
 */
export const REVIEW_STATUSES = ["pending", "published", "rejected", "flagged"];

const reviewSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    externalRef: { type: String, trim: true },
    business: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: "Customer" },
    reviewerName: { type: String, trim: true, required: true },
    reviewerPhone: { type: String, trim: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true },
    body: { type: String, trim: true, required: true },
    jobDate: { type: Date },

    status: { type: String, enum: REVIEW_STATUSES, default: "pending", index: true },
    moderation: {
      by: { type: Schema.Types.ObjectId },
      byName: { type: String, trim: true },
      at: { type: Date },
      reason: { type: String, trim: true },
    },
    flags: { type: Number, default: 0 },

    businessResponse: {
      body: { type: String, trim: true },
      at: { type: Date },
    },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

reviewSchema.index({ tenantId: 1, business: 1, status: 1 });
reviewSchema.index({ tenantId: 1, externalRef: 1 }, { unique: true, sparse: true });
reviewSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

reviewSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Review = registerModel(crmConnection, "Review", reviewSchema);
export default Review;
