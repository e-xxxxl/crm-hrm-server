import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

const customComponent = new Schema(
  { name: { type: String, trim: true, required: true }, amount: { type: Number, required: true, min: 0 }, taxable: { type: Boolean, default: true }, pensionable: { type: Boolean, default: false } },
  { _id: false },
);

/**
 * The active pay definition for one employee. Which fields matter depends on the
 * organization's payroll strategy:
 *   fixed-monthly    → grossMonthly (or basic)
 *   hybrid           → basic + commissionPerTrip
 *   allowance-based  → basic + housing + transport + hazard + meal (+ custom)
 *
 * A new structure is created (not edited) whenever pay changes; the previous one
 * is closed with `effectiveTo` so history is preserved.
 */
const salaryStructureSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

    currency: { type: String, default: "NGN" },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    isCurrent: { type: Boolean, default: true, index: true },

    // Earnings (monthly)
    basic: { type: Number, default: 0, min: 0 },
    housing: { type: Number, default: 0, min: 0 },
    transport: { type: Number, default: 0, min: 0 },
    subsidy: { type: Number, default: 0, min: 0 }, // formerly "hazard"
    dataAllowance: { type: Number, default: 0, min: 0 }, // formerly "meal"
    exGratia: { type: Number, default: 0, min: 0 },
    referralBonus: { type: Number, default: 0, min: 0 },
    customEarnings: { type: [customComponent], default: [] },

    // Strategy-specific
    grossMonthly: { type: Number, default: 0, min: 0 }, // fixed-monthly override
    commissionPerTrip: { type: Number, default: 0, min: 0 }, // hybrid

    // Statutory toggles
    payeApplicable: { type: Boolean, default: true },
    pensionApplicable: { type: Boolean, default: true },
    nhfApplicable: { type: Boolean, default: false },

    reason: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

salaryStructureSchema.index({ organizationId: 1, employee: 1, isCurrent: 1 });

/** Sum of all fixed monthly earnings (excludes variable commission). */
salaryStructureSchema.virtual("fixedGross").get(function () {
  const custom = (this.customEarnings || []).reduce((s, c) => s + (c.amount || 0), 0);
  const components =
    this.basic + this.housing + this.transport + this.subsidy + this.dataAllowance +
    this.exGratia + this.referralBonus + custom;
  return this.grossMonthly > 0 && components === 0 ? this.grossMonthly : components || this.grossMonthly;
});

/** Pensionable base = basic + housing + transport (+ flagged custom). */
salaryStructureSchema.virtual("pensionableBase").get(function () {
  const custom = (this.customEarnings || [])
    .filter((c) => c.pensionable)
    .reduce((s, c) => s + (c.amount || 0), 0);
  return this.basic + this.housing + this.transport + custom;
});

salaryStructureSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const SalaryStructure = registerModel(hrmConnection, "SalaryStructure", salaryStructureSchema);
export default SalaryStructure;
