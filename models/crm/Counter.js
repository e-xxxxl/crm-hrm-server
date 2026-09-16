import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * CRM-side atomic counters (customer ids, ticket numbers, order/shipment
 * references, …). Lives in crm_db, separate from the HRM counter.
 */
const counterSchema = new Schema({
  _id: { type: String, required: true }, // e.g. "<tenantId>:customer"
  seq: { type: Number, default: 0 },
});

const Counter = registerModel(crmConnection, "Counter", counterSchema);

export async function nextSequence(scopeKey) {
  const doc = await Counter.findByIdAndUpdate(
    scopeKey,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc.seq;
}

export async function nextCode(prefix, scopeKey, pad = 5) {
  const n = await nextSequence(scopeKey);
  return `${prefix}-${String(n).padStart(pad, "0")}`;
}

export default Counter;
