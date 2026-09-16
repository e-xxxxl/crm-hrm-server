import mongoose from "mongoose";
import { crmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"];
export const TASK_TYPES = ["follow_up", "call", "email", "visit", "admin", "other"];

const commentSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId },
    byName: { type: String, trim: true },
    body: { type: String, trim: true, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const taskSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    reference: { type: String, required: true },

    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    type: { type: String, enum: TASK_TYPES, default: "follow_up" },
    priority: { type: String, enum: ["low", "normal", "high"], default: "normal" },

    // Optional link to another CRM record
    relatedType: { type: String, enum: ["customer", "ticket", "lead", "shipment", "order", "business", ""], default: "" },
    relatedId: { type: Schema.Types.ObjectId },
    relatedLabel: { type: String, trim: true },

    assignee: { type: Schema.Types.ObjectId },
    assigneeName: { type: String, trim: true },

    dueAt: { type: Date, index: true },
    reminderAt: { type: Date },
    reminderSent: { type: Boolean, default: false },
    overdueNotified: { type: Boolean, default: false },

    status: { type: String, enum: TASK_STATUSES, default: "open", index: true },
    completedAt: { type: Date },
    outcome: { type: String, trim: true },

    comments: { type: [commentSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

taskSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
taskSchema.index({ tenantId: 1, assignee: 1, status: 1, dueAt: 1 });
taskSchema.index({ tenantId: 1, relatedType: 1, relatedId: 1 });

taskSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Task = registerModel(crmConnection, "Task", taskSchema);
export default Task;
