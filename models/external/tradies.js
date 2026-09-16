import mongoose from "mongoose";
import { tradiesSourceConnection } from "../../config/externalSources.js";

/**
 * READ-ONLY mirrors of 9jaTradiesPages' own production schema
 * (see C:\Users\HP\Desktop\Services\server\models).
 */
const { Schema } = mongoose;

const userSchema = new Schema(
  { email: String, fullName: String, accountType: String, phone: String, state: String, city: String, providerProfile: Schema.Types.ObjectId, isActive: Boolean, createdAt: Date },
  { strict: false, collection: "users" },
);

const providerSchema = new Schema(
  {
    user: Schema.Types.ObjectId,
    companyName: String,
    serviceType: String,
    tagline: String,
    verificationStatus: String,
    isVisible: Boolean,
    businessAddress: Schema.Types.Mixed,
    city: String,
    state: String,
    serviceArea: [Schema.Types.Mixed],
    businessDescription: String,
    servicesOffered: [Schema.Types.Mixed],
    rating: Number,
    totalReviews: Number,
    completedJobs: Number,
    subscription: Schema.Types.Mixed,
    createdAt: Date,
  },
  { strict: false, collection: "serviceproviders" },
);

const jobSchema = new Schema(
  {
    title: String,
    description: String,
    customer: Schema.Types.ObjectId,
    provider: Schema.Types.ObjectId,
    serviceType: String,
    location: String,
    budget: String,
    urgency: String,
    status: String,
    completedAt: Date,
    createdAt: Date,
  },
  { strict: false, collection: "jobs" },
);

const reviewSchema = new Schema(
  { customer: Schema.Types.ObjectId, provider: Schema.Types.ObjectId, rating: Number, comment: String, createdAt: Date },
  { strict: false, collection: "reviews" },
);

export const TradiesUser = tradiesSourceConnection?.models.User || tradiesSourceConnection?.model("User", userSchema);
export const TradiesProvider = tradiesSourceConnection?.models.ServiceProvider || tradiesSourceConnection?.model("ServiceProvider", providerSchema);
export const TradiesJob = tradiesSourceConnection?.models.Job || tradiesSourceConnection?.model("Job", jobSchema);
export const TradiesReview = tradiesSourceConnection?.models.Review || tradiesSourceConnection?.model("Review", reviewSchema);

export default { TradiesUser, TradiesProvider, TradiesJob, TradiesReview };
