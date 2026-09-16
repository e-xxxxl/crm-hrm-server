import * as service from "../../services/crm/order.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listOrders(req.tenantId, req.query));
});

export const stats = catchAsync(async (req, res) => {
  res.json({ data: await service.orderStats(req.tenantId) });
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getOrder(req.tenantId, req.params.id) });
});

export const quote = catchAsync(async (req, res) => {
  res.json({ data: service.quoteFor(req.body) });
});

export const create = catchAsync(async (req, res) => {
  const order = await service.createOrder(req.tenantId, req.auth, req.body);
  await recordAudit(req, {
    action: "order.create",
    entityType: "Order",
    entityId: order._id,
    entityLabel: order.orderNumber,
    summary: `Created order ${order.orderNumber} — quote ₦${order.quote?.total}`,
  });
  res.status(201).json({ data: order });
});

export const requote = catchAsync(async (req, res) => {
  res.json({ data: await service.requote(req.tenantId, req.params.id, req.body) });
});

export const confirm = catchAsync(async (req, res) => {
  const order = await service.confirmOrder(req.tenantId, req.auth, req.params.id);
  await recordAudit(req, {
    action: "order.confirm",
    entityType: "Order",
    entityId: order._id,
    entityLabel: order.orderNumber,
    summary: `Confirmed order ${order.orderNumber} — tracking ${order.trackingNumber}`,
  });
  res.json({ data: order });
});

export const payment = catchAsync(async (req, res) => {
  const order = await service.recordPayment(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "order.payment",
    entityType: "Order",
    entityId: order._id,
    entityLabel: order.orderNumber,
    summary: `Order ${order.orderNumber} payment ${order.paymentStatus}`,
  });
  res.json({ data: order });
});

export const updateStatus = catchAsync(async (req, res) => {
  const order = await service.updateStatus(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "order.status",
    entityType: "Order",
    entityId: order._id,
    entityLabel: order.orderNumber,
    summary: `${order.orderNumber} → ${order.status}`,
  });
  res.json({ data: order });
});

export const assignRider = catchAsync(async (req, res) => {
  res.json({ data: await service.assignRider(req.tenantId, req.auth, req.params.id, req.body) });
});

export default { list, stats, get, quote, create, requote, confirm, payment, updateStatus, assignRider };
