import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * An organization is one of the businesses operating on the platform. Payroll
 * behaviour is org-specific and selected by `payrollStrategy`.
 */

export const PAYROLL_STRATEGIES = ["fixed-monthly", "hybrid", "allowance-based"];
export const ORG_TYPES = ["marketplace", "logistics", "courier", "generic"];

const settingsSchema = new Schema(
  {
    timezone: { type: String, default: "Africa/Lagos" },
    currency: { type: String, default: "NGN" },
    workweek: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0=Sun … 6=Sat
    standardClockIn: { type: String, default: "08:00" }, // HH:mm, local
    lateGraceMinutes: { type: Number, default: 15 },
    standardWorkHours: { type: Number, default: 8 },
    minBranchCoverage: { type: Number, default: 1 }, // leave approval floor
    payFrequency: { type: String, enum: ["monthly"], default: "monthly" },
    payDayOfMonth: { type: Number, default: 28, min: 1, max: 31 },
    probationMonths: { type: Number, default: 3 },
    contractAlertDays: { type: [Number], default: [30, 14, 7] },

    // HR configuration (managed from HR Settings)
    reviewCyclesPerYear: { type: Number, default: 4, min: 1, max: 12 },
    documentTypes: {
      type: [String],
      default: [
        "Employment Contract",
        "Offer Letter",
        "NIN Slip",
        "Means of Identification",
        "Educational Certificate",
        "Professional Certification",
        "Guarantor Form",
        "Medical Report",
        "Reference Letter",
        "Other",
      ],
    },
    notifications: {
      leaveWorkflow: { type: Boolean, default: true },
      payslipReady: { type: Boolean, default: true },
      contractExpiry: { type: Boolean, default: true },
      reviewDue: { type: Boolean, default: true },
      targetDeadline: { type: Boolean, default: true },
    },
  },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ORG_TYPES, default: "generic" },
    payrollStrategy: { type: String, enum: PAYROLL_STRATEGIES, required: true },

    legalName: { type: String, trim: true },
    rcNumber: { type: String, trim: true }, // CAC registration number
    tin: { type: String, trim: true }, // tax identification number
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },
    state: { type: String, trim: true },
    lga: { type: String, trim: true },
    logoUrl: { type: String, trim: true },

    settings: { type: settingsSchema, default: () => ({}) },

    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

organizationSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject({ virtuals: true });
  obj.id = obj._id;
  delete obj._id;
  delete obj.__v;
  return obj;
};

export const Organization = registerModel(hrmConnection, "Organization", organizationSchema);
export default Organization;
