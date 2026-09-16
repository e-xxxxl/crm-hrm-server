import mongoose from "mongoose";
import { Task } from "../../models/crm/Task.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { parsePagination, paginated, escapeRegex } from "../../utils/query.js";
import { notify } from "../notification.service.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const OPEN = ["open", "in_progress"];

export async function createTask(tenantId, actor, input) {
  const reference = await nextCode("TASK", `${tenantId}:task`, 5);
  const task = await Task.create({
    tenantId,
    reference,
    title: input.title,
    description: input.description,
    type: input.type || "follow_up",
    priority: input.priority || "normal",
    relatedType: input.relatedType || "",
    relatedId: input.relatedId ? oid(input.relatedId) : undefined,
    relatedLabel: input.relatedLabel,
    assignee: input.assignee ? oid(input.assignee) : actor.userId,
    assigneeName: input.assigneeName || (input.assignee ? undefined : actor.name),
    dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    reminderAt: input.reminderAt ? new Date(input.reminderAt) : undefined,
    createdBy: actor.userId,
  });

  if (task.assignee && String(task.assignee) !== String(actor.userId)) {
    await notify(tenantId, {
      to: { user: task.assignee },
      type: "task.reminder",
      title: `Task assigned: ${task.title}`,
      body: task.dueAt ? `Due ${task.dueAt.toLocaleString("en-NG")}` : "No due date",
      link: `/crm/tasks?open=${task._id}`,
    });
  }
  return task;
}

export async function listTasks(tenantId, actor, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId: oid(tenantId) };

  if (query.status) filter.status = query.status;
  else if (query.open === "true") filter.status = { $in: OPEN };
  if (query.mine === "true") filter.assignee = oid(actor.userId);
  else if (query.assignee) filter.assignee = oid(query.assignee);
  if (query.type) filter.type = query.type;
  if (query.priority) filter.priority = query.priority;
  if (query.relatedType && query.relatedId) {
    filter.relatedType = query.relatedType;
    filter.relatedId = oid(query.relatedId);
  }
  if (query.overdue === "true") {
    filter.status = { $in: OPEN };
    filter.dueAt = { $lt: new Date() };
  }
  if (query.dueToday === "true") {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    filter.status = { $in: OPEN };
    filter.dueAt = { $lte: end };
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), "i");
    filter.$or = [{ title: rx }, { reference: rx }, { relatedLabel: rx }];
  }

  const sort = query.sort === "created" ? { createdAt: -1 } : { dueAt: 1, createdAt: -1 };
  const [items, total] = await Promise.all([
    Task.find(filter).sort(sort).skip(skip).limit(limit),
    Task.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getTask(tenantId, id) {
  const task = await Task.findOne({ _id: id, tenantId });
  if (!task) throw AppError.notFound("Task not found");
  return task;
}

export async function updateTask(tenantId, actor, id, input) {
  const task = await Task.findOne({ _id: id, tenantId });
  if (!task) throw AppError.notFound("Task not found");

  const before = String(task.assignee || "");
  const editable = ["title", "description", "type", "priority", "relatedType", "relatedLabel", "assigneeName", "outcome"];
  for (const k of editable) if (input[k] !== undefined) task[k] = input[k];
  if (input.assignee !== undefined) task.assignee = input.assignee ? oid(input.assignee) : undefined;
  if (input.relatedId !== undefined) task.relatedId = input.relatedId ? oid(input.relatedId) : undefined;
  if (input.dueAt !== undefined) task.dueAt = input.dueAt ? new Date(input.dueAt) : undefined;
  if (input.reminderAt !== undefined) {
    task.reminderAt = input.reminderAt ? new Date(input.reminderAt) : undefined;
    task.reminderSent = false;
  }
  if (input.status !== undefined) {
    task.status = input.status;
    if (input.status === "done" && !task.completedAt) task.completedAt = new Date();
    if (input.status !== "done") task.completedAt = undefined;
  }
  await task.save();

  if (task.assignee && String(task.assignee) !== before && String(task.assignee) !== String(actor.userId)) {
    await notify(tenantId, {
      to: { user: task.assignee },
      type: "task.reminder",
      title: `Task reassigned to you: ${task.title}`,
      link: `/crm/tasks?open=${task._id}`,
    });
  }
  return task;
}

export async function completeTask(tenantId, actor, id, outcome) {
  const task = await Task.findOne({ _id: id, tenantId });
  if (!task) throw AppError.notFound("Task not found");
  task.status = "done";
  task.completedAt = new Date();
  if (outcome) task.outcome = outcome;
  await task.save();
  return task;
}

export async function addComment(tenantId, actor, id, body) {
  const task = await Task.findOneAndUpdate(
    { _id: id, tenantId },
    { $push: { comments: { by: actor.userId, byName: actor.name, body, at: new Date() } } },
    { new: true },
  );
  if (!task) throw AppError.notFound("Task not found");
  return task;
}

export async function taskStats(tenantId, actor) {
  const t = oid(tenantId);
  const now = new Date();
  const [mineOpen, overdue, dueToday, unassigned] = await Promise.all([
    Task.countDocuments({ tenantId: t, assignee: oid(actor.userId), status: { $in: OPEN } }),
    Task.countDocuments({ tenantId: t, status: { $in: OPEN }, dueAt: { $lt: now } }),
    Task.countDocuments({
      tenantId: t,
      status: { $in: OPEN },
      dueAt: { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59) },
    }),
    Task.countDocuments({ tenantId: t, status: { $in: OPEN }, assignee: { $exists: false } }),
  ]);
  return { mineOpen, overdue, dueToday, unassigned };
}

/** Reminder + overdue sweep — called from the maintenance scheduler. */
export async function sweepTaskReminders(tenantId) {
  const now = new Date();
  let sent = 0;

  const dueReminders = await Task.find({
    tenantId,
    status: { $in: OPEN },
    reminderSent: false,
    reminderAt: { $lte: now },
    assignee: { $exists: true },
  });
  for (const task of dueReminders) {
    await notify(tenantId, {
      to: { user: task.assignee },
      type: "task.reminder",
      title: `Reminder: ${task.title}`,
      body: task.dueAt ? `Due ${task.dueAt.toLocaleString("en-NG")}` : "",
      link: `/crm/tasks?open=${task._id}`,
    });
    task.reminderSent = true;
    await task.save();
    sent += 1;
  }

  const overdue = await Task.find({
    tenantId,
    status: { $in: OPEN },
    overdueNotified: false,
    dueAt: { $lt: now },
    assignee: { $exists: true },
  });
  for (const task of overdue) {
    await notify(tenantId, {
      to: { user: task.assignee },
      type: "task.reminder",
      title: `Task overdue: ${task.title}`,
      link: `/crm/tasks?open=${task._id}`,
    });
    task.overdueNotified = true;
    await task.save();
    sent += 1;
  }
  return sent;
}

export default {
  createTask,
  listTasks,
  getTask,
  updateTask,
  completeTask,
  addComment,
  taskStats,
  sweepTaskReminders,
};
