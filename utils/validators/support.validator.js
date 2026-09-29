import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");
const relatedType = z.enum(["customer", "ticket", "lead", "shipment", "order", "business", ""]);

export const createTaskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  type: z.enum(["follow_up", "call", "email", "visit", "admin", "other"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  relatedType: relatedType.optional(),
  relatedId: objectId.optional(),
  relatedLabel: z.string().max(200).optional(),
  assignee: objectId.optional(),
  assigneeName: z.string().max(120).optional(),
  dueAt: z.coerce.date().optional(),
  reminderAt: z.coerce.date().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  outcome: z.string().max(2000).optional(),
});

export const completeTaskSchema = z.object({ outcome: z.string().max(2000).optional() });
export const taskCommentSchema = z.object({ body: z.string().min(1).max(2000) });

export const taskListQuerySchema = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  open: z.enum(["true", "false"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  assignee: objectId.optional(),
  type: z.string().max(30).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  relatedType: relatedType.optional(),
  relatedId: objectId.optional(),
  overdue: z.enum(["true", "false"]).optional(),
  dueToday: z.enum(["true", "false"]).optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["due", "created"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const logCommSchema = z.object({
  customer: objectId.optional(),
  channel: z.enum(["call", "whatsapp", "sms", "email", "note", "meeting", "in_person"]),
  direction: z.enum(["inbound", "outbound", "internal"]).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(10000),
  occurredAt: z.coerce.date().optional(),
  durationSeconds: z.coerce.number().int().nonnegative().optional(),
  outcome: z.string().max(300).optional(),
  relatedType: z.enum(["ticket", "lead", "shipment", "order", ""]).optional(),
  relatedId: objectId.optional(),
  relatedLabel: z.string().max(200).optional(),
  attachments: z.array(z.object({ name: z.string().max(200), url: z.string().max(500) })).max(10).optional(),
});

export const sendEmailSchema = z.object({
  customer: objectId,
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  attachments: z.array(z.object({ id: objectId, name: z.string().max(200).optional() })).max(5).optional(),
});

export const commListQuerySchema = z.object({
  customer: objectId.optional(),
  channel: z.string().max(20).optional(),
  direction: z.enum(["inbound", "outbound", "internal"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const auditQuerySchema = z.object({
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: objectId.optional(),
  actor: objectId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export default {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  taskCommentSchema,
  taskListQuerySchema,
  logCommSchema,
  sendEmailSchema,
  commListQuerySchema,
  auditQuerySchema,
};
