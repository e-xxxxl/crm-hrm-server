import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Append-only record of significant HR actions. Written by services, never
 * edited or deleted through the API.
 */
const auditLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true },
    actorRole: { type: String, trim: true },

    action: { type: String, required: true, trim: true }, // e.g. "employee.create"
    entityType: { type: String, trim: true }, // e.g. "Employee"
    entityId: { type: Schema.Types.ObjectId },
    entityLabel: { type: String, trim: true },

    summary: { type: String, trim: true },
    changes: { type: Schema.Types.Mixed }, // { field: { from, to } }
    metadata: { type: Schema.Types.Mixed },

    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1 });

auditLogSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const AuditLog = registerModel(hrmConnection, "AuditLog", auditLogSchema);
export default AuditLog;
