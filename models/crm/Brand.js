import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * A brand is the CRM-facing profile of an organization (tenant). Each of the
 * three organizations is exactly one brand; `tenantId` mirrors the HRM
 * `organizationId` so a single login context scopes both sides of the platform.
 *
 * `kind` selects which brand module applies (Phase 9):
 *   marketplace → 9jaTradiesPages (businesses, leads, reviews)
 *   logistics   → QuickShipAfrica (orders, quotes, tracking)
 *   courier     → AJCL (shipment lifecycle, COD, POD)
 */
export const BRAND_KINDS = ["marketplace", "logistics", "courier", "generic"];

const channelSchema = new Schema(
  {
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    website: { type: String, trim: true },
  },
  { _id: false },
);

const brandSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    organizationName: { type: String, required: true, trim: true },

    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true, unique: true },
    code: { type: String, required: true, uppercase: true, trim: true, unique: true },
    kind: { type: String, enum: BRAND_KINDS, default: "generic" },

    description: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    primaryColor: { type: String, trim: true, default: "#0f172a" },
    supportChannels: { type: channelSchema, default: () => ({}) },

    // Config knobs consumed by the brand modules.
    settings: {
      trackingPrefix: { type: String, trim: true, uppercase: true }, // e.g. "AJCL"
      ticketPrefix: { type: String, trim: true, uppercase: true, default: "TKT" },
      codEnabled: { type: Boolean, default: false },
      slaHours: { type: Number, default: 48 }, // default ticket resolution SLA
    },

    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

brandSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Brand = registerModel(crmConnection, "Brand", brandSchema);
export default Brand;
