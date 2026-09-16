import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const CUSTOMER_TYPES = ["individual", "business"];
export const CUSTOMER_STATUSES = ["active", "inactive", "blocked"];

const contactPointSchema = new Schema(
  {
    value: { type: String, required: true, trim: true },
    label: { type: String, trim: true, default: "primary" },
    primary: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
  },
  { _id: true },
);

const addressSchema = new Schema(
  {
    label: { type: String, trim: true, default: "Home" },
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    lga: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true, default: "Nigeria" },
    landmark: { type: String, trim: true },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const noteSchema = new Schema(
  {
    body: { type: String, required: true, trim: true },
    by: { type: Schema.Types.ObjectId },
    byName: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const customerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    customerId: { type: String, required: true }, // human ref, e.g. CUS-00001

    type: { type: String, enum: CUSTOMER_TYPES, default: "individual" },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    businessName: { type: String, trim: true },
    rcNumber: { type: String, trim: true },

    gender: { type: String, enum: ["Male", "Female", ""], default: "" },
    dateOfBirth: { type: Date },

    emails: { type: [contactPointSchema], default: [] },
    phones: { type: [contactPointSchema], default: [] },
    addresses: { type: [addressSchema], default: [] },

    source: { type: String, trim: true, default: "direct" },
    segment: { type: String, trim: true },
    tags: { type: [String], default: [] },

    owner: { type: Schema.Types.ObjectId }, // account manager (User)
    ownerName: { type: String, trim: true },

    status: { type: String, enum: CUSTOMER_STATUSES, default: "active" },
    blockReason: { type: String, trim: true },

    consent: {
      marketingEmail: { type: Boolean, default: false },
      marketingSms: { type: Boolean, default: false },
    },

    // Denormalised rollups maintained by brand modules (Phase 9+).
    stats: {
      orders: { type: Number, default: 0 },
      shipments: { type: Number, default: 0 },
      tickets: { type: Number, default: 0 },
      lifetimeValue: { type: Number, default: 0 },
      outstandingCod: { type: Number, default: 0 },
      lastActivityAt: { type: Date },
    },

    // Links to brand-module records so order / tracking lookups resolve back here.
    externalRefs: {
      type: [
        new Schema(
          {
            system: { type: String, required: true }, // "quickship-order", "ajcl-shipment", …
            ref: { type: String, required: true }, // order number / tracking number
            recordId: { type: Schema.Types.ObjectId },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    notes: { type: [noteSchema], default: [] },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

customerSchema.index({ tenantId: 1, customerId: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, "phones.value": 1 });
customerSchema.index({ tenantId: 1, "emails.value": 1 });
customerSchema.index({ tenantId: 1, "externalRefs.ref": 1 });
customerSchema.index(
  { firstName: "text", lastName: "text", businessName: "text", "emails.value": "text", "phones.value": "text" },
  { name: "customer_text" },
);

customerSchema.virtual("displayName").get(function () {
  if (this.type === "business") return this.businessName || "Unnamed business";
  return [this.firstName, this.lastName].filter(Boolean).join(" ") || "Unnamed customer";
});

customerSchema.virtual("primaryEmail").get(function () {
  return (this.emails.find((e) => e.primary) || this.emails[0])?.value || null;
});
customerSchema.virtual("primaryPhone").get(function () {
  return (this.phones.find((p) => p.primary) || this.phones[0])?.value || null;
});

customerSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Customer = registerModel(crmConnection, "Customer", customerSchema);
export default Customer;
