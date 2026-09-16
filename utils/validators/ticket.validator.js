import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "invalid id");

const attachment = z.object({
  fileId: objectId.optional(),
  name: z.string().max(200),
  url: z.string().max(500),
  size: z.number().nonnegative().optional(),
  contentType: z.string().max(120).optional(),
});

export const createTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  description: z.string().max(10000).optional(),
  customer: objectId.optional(),
  category: z.string().max(60).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  channel: z.enum(["phone", "email", "whatsapp", "walk-in", "web", "social", "system"]).optional(),
  assignee: objectId.optional(),
  assignedTeam: z.string().max(80).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  fromCustomer: z.boolean().optional(),
  mentions: z.array(objectId).max(20).optional(),
  attachments: z.array(attachment).max(10).optional(),
  related: z
    .object({ type: z.string().max(60), ref: z.string().max(120), recordId: objectId.optional() })
    .optional(),
});

export const ticketListQuerySchema = z.object({
  status: z.enum(["open", "pending", "on_hold", "resolved", "closed", "reopened"]).optional(),
  open: z.enum(["true", "false"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  category: z.string().max(60).optional(),
  customer: objectId.optional(),
  channel: z.string().max(20).optional(),
  tag: z.string().max(40).optional(),
  escalated: z.enum(["true", "false"]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  unassigned: z.enum(["true", "false"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  assignee: objectId.optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["recent", "oldest", "due"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const addUpdateSchema = z.object({
  type: z.enum(["staff_update", "internal_note", "customer_update"]).optional(),
  body: z.string().min(1).max(10000),
  mentions: z.array(objectId).max(20).optional(),
  attachments: z.array(attachment).max(10).optional(),
});

export const assignSchema = z
  .object({ assignee: objectId.optional(), team: z.string().max(80).optional() })
  .refine((v) => v.assignee || v.team || v.assignee === null, { message: "assignee or team required" });

export const statusSchema = z.object({
  status: z.enum(["open", "pending", "on_hold", "resolved", "closed", "reopened"]),
  note: z.string().max(2000).optional(),
});

export const prioritySchema = z.object({
  priority: z.enum(["low", "normal", "high", "urgent"]),
  note: z.string().max(2000).optional(),
});

export const escalateSchema = z.object({
  reason: z.string().max(2000).optional(),
  to: objectId.optional(),
});

export const dueDateSchema = z.object({ dueAt: z.coerce.date() });
export const watchSchema = z.object({ watch: z.boolean().optional() });

export default {
  createTicketSchema,
  ticketListQuerySchema,
  addUpdateSchema,
  assignSchema,
  statusSchema,
  prioritySchema,
  escalateSchema,
  dueDateSchema,
  watchSchema,
};
