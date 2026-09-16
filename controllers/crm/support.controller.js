import * as tasks from "../../services/crm/task.service.js";
import * as comms from "../../services/crm/communication.service.js";
import * as sales from "../../services/crm/sales.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

/* ---- Tasks ---- */
export const listTasks = catchAsync(async (req, res) => {
  res.json(await tasks.listTasks(req.tenantId, req.auth, req.query));
});
export const taskStats = catchAsync(async (req, res) => {
  res.json({ data: await tasks.taskStats(req.tenantId, req.auth) });
});
export const getTask = catchAsync(async (req, res) => {
  res.json({ data: await tasks.getTask(req.tenantId, req.params.id) });
});
export const createTask = catchAsync(async (req, res) => {
  const task = await tasks.createTask(req.tenantId, req.auth, req.body);
  await recordAudit(req, { action: "task.create", entityType: "Task", entityId: task._id, entityLabel: task.reference, summary: `Created task "${task.title}"` });
  res.status(201).json({ data: task });
});
export const updateTask = catchAsync(async (req, res) => {
  res.json({ data: await tasks.updateTask(req.tenantId, req.auth, req.params.id, req.body) });
});
export const completeTask = catchAsync(async (req, res) => {
  const task = await tasks.completeTask(req.tenantId, req.auth, req.params.id, req.body.outcome);
  await recordAudit(req, { action: "task.complete", entityType: "Task", entityId: task._id, entityLabel: task.reference, summary: `Completed task "${task.title}"` });
  res.json({ data: task });
});
export const addTaskComment = catchAsync(async (req, res) => {
  res.json({ data: await tasks.addComment(req.tenantId, req.auth, req.params.id, req.body.body) });
});

/* ---- Communications ---- */
export const listComms = catchAsync(async (req, res) => {
  res.json(await comms.listCommunications(req.tenantId, req.query));
});
export const logComm = catchAsync(async (req, res) => {
  const comm = await comms.logCommunication(req.tenantId, req.auth, req.body);
  await recordAudit(req, { action: "communication.log", entityType: "Communication", entityId: comm._id, summary: `Logged ${comm.channel} communication` });
  res.status(201).json({ data: comm });
});
export const deleteComm = catchAsync(async (req, res) => {
  const result = await comms.deleteCommunication(req.tenantId, req.params.id);
  await recordAudit(req, { action: "communication.delete", entityType: "Communication", entityId: req.params.id, summary: "Deleted a communication log" });
  res.json({ data: result });
});

/* ---- Sales ---- */
export const salesOverview = catchAsync(async (req, res) => {
  res.json({ data: await sales.salesOverview(req.tenantId, { months: req.query.months ? Number(req.query.months) : 6 }) });
});

export default {
  listTasks,
  taskStats,
  getTask,
  createTask,
  updateTask,
  completeTask,
  addTaskComment,
  listComms,
  logComm,
  deleteComm,
  salesOverview,
};
