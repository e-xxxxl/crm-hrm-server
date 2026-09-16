import * as service from "../../services/crm/ticket.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";
import { hasPermission } from "../../utils/permissions.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listTickets(req.tenantId, req.auth, req.query));
});

export const stats = catchAsync(async (req, res) => {
  res.json({ data: await service.ticketStats(req.tenantId, req.auth) });
});

export const get = catchAsync(async (req, res) => {
  // Support agents see everything; anyone else without ticket:write sees only
  // customer-visible entries.
  const includeInternal = hasPermission(req.auth.permissions, "ticket:write");
  res.json({ data: await service.getTicket(req.tenantId, req.params.id, { includeInternal }) });
});

export const create = catchAsync(async (req, res) => {
  const ticket = await service.createTicket(req.tenantId, req.auth, req.body);
  await recordAudit(req, {
    action: "ticket.create",
    entityType: "Ticket",
    entityId: ticket.id,
    entityLabel: ticket.ticketNumber,
    summary: `Opened ticket ${ticket.ticketNumber} — ${ticket.subject}`,
  });
  res.status(201).json({ data: ticket });
});

export const addUpdate = catchAsync(async (req, res) => {
  const entry = await service.addUpdate(req.tenantId, req.auth, req.params.id, req.body);
  res.status(201).json({ data: entry });
});

export const assign = catchAsync(async (req, res) => {
  const ticket = await service.assign(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "ticket.assign",
    entityType: "Ticket",
    entityId: ticket.id,
    entityLabel: ticket.ticketNumber,
    summary: `Assigned ${ticket.ticketNumber} to ${ticket.assigneeName || req.body.team || "unassigned"}`,
  });
  res.json({ data: ticket });
});

export const changeStatus = catchAsync(async (req, res) => {
  const ticket = await service.changeStatus(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "ticket.status",
    entityType: "Ticket",
    entityId: ticket.id,
    entityLabel: ticket.ticketNumber,
    summary: `${ticket.ticketNumber} → ${ticket.status}`,
  });
  res.json({ data: ticket });
});

export const changePriority = catchAsync(async (req, res) => {
  const ticket = await service.changePriority(req.tenantId, req.auth, req.params.id, req.body);
  res.json({ data: ticket });
});

export const escalate = catchAsync(async (req, res) => {
  const ticket = await service.escalate(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "ticket.escalate",
    entityType: "Ticket",
    entityId: ticket.id,
    entityLabel: ticket.ticketNumber,
    summary: `Escalated ${ticket.ticketNumber} (now ${ticket.priority})`,
  });
  res.json({ data: ticket });
});

export const setDueDate = catchAsync(async (req, res) => {
  res.json({ data: await service.setDueDate(req.tenantId, req.auth, req.params.id, req.body) });
});

export const watch = catchAsync(async (req, res) => {
  res.json({ data: await service.toggleWatch(req.tenantId, req.auth, req.params.id, req.body.watch !== false) });
});

export default {
  list,
  stats,
  get,
  create,
  addUpdate,
  assign,
  changeStatus,
  changePriority,
  escalate,
  setDueDate,
  watch,
};
