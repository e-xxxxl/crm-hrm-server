import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

const lineItemSchema = new Schema(
  {
    description: { type: String, trim: true, required: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 }, // quantity * unitPrice, computed on save
  },
  { _id: false },
);

/**
 * A billing document a staff member generates for a customer — either an
 * invoice (amount owed) or a receipt (amount already paid) — and can email
 * out as a PDF via services/crm/email.service.js.
 */
const invoiceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    number: { type: String, required: true },
    kind: { type: String, enum: ["invoice", "receipt"], default: "invoice" },

    customer: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    customerSnapshot: { name: String, email: String, phone: String, address: String },

    lineItems: { type: [lineItemSchema], default: [] },
    currency: { type: String, default: "NGN" },
    subtotal: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 }, // percent
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    notes: { type: String, trim: true, maxlength: 6000 },
    dueDate: { type: Date },

    status: { type: String, enum: ["draft", "sent", "paid", "void"], default: "draft" },
    sentAt: { type: Date },
    sentTo: { type: String, trim: true },
    paidAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

invoiceSchema.index({ tenantId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, customer: 1, createdAt: -1 });

invoiceSchema.pre("validate", function computeTotals() {
  for (const item of this.lineItems) {
    item.amount = Math.round((item.quantity || 0) * (item.unitPrice || 0) * 100) / 100;
  }
  this.subtotal = Math.round(this.lineItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  this.taxAmount = Math.round(this.subtotal * ((this.taxRate || 0) / 100) * 100) / 100;
  this.total = Math.round((this.subtotal + this.taxAmount) * 100) / 100;
});

invoiceSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Invoice = registerModel(crmConnection, "Invoice", invoiceSchema);
export default Invoice;
