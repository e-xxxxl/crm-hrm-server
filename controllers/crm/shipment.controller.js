import * as service from "../../services/crm/shipment.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listShipments(req.tenantId, req.query));
});

export const stats = catchAsync(async (req, res) => {
  res.json({ data: await service.shipmentStats(req.tenantId) });
});

export const track = catchAsync(async (req, res) => {
  res.json({ data: await service.trackByNumber(req.tenantId, req.params.trackingNumber) });
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getShipment(req.tenantId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const shipment = await service.createShipment(req.tenantId, req.auth, req.body);
  await recordAudit(req, {
    action: "shipment.create",
    entityType: "Shipment",
    entityId: shipment._id,
    entityLabel: shipment.trackingNumber,
    summary: `Booked shipment ${shipment.trackingNumber} → ${shipment.recipient?.name || "recipient"}`,
  });
  res.status(201).json({ data: shipment });
});

export const updateStatus = catchAsync(async (req, res) => {
  const shipment = await service.updateStatus(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "shipment.status",
    entityType: "Shipment",
    entityId: shipment._id,
    entityLabel: shipment.trackingNumber,
    summary: `${shipment.trackingNumber} → ${shipment.status}`,
  });
  res.json({ data: shipment });
});

export const assignRider = catchAsync(async (req, res) => {
  const shipment = await service.assignRider(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "shipment.assign_rider",
    entityType: "Shipment",
    entityId: shipment._id,
    entityLabel: shipment.trackingNumber,
    summary: `Assigned ${shipment.trackingNumber} to ${shipment.riderName || "rider"}`,
  });
  res.json({ data: shipment });
});

export const capturePod = catchAsync(async (req, res) => {
  const shipment = await service.capturePod(req.tenantId, req.auth, req.params.id, req.body);
  await recordAudit(req, {
    action: "shipment.pod",
    entityType: "Shipment",
    entityId: shipment._id,
    entityLabel: shipment.trackingNumber,
    summary: `Delivered ${shipment.trackingNumber} — received by ${req.body.recipientName}`,
  });
  res.json({ data: shipment });
});

export const remitCod = catchAsync(async (req, res) => {
  const shipment = await service.remitCod(req.tenantId, req.auth, req.params.id);
  await recordAudit(req, {
    action: "shipment.cod_remit",
    entityType: "Shipment",
    entityId: shipment._id,
    entityLabel: shipment.trackingNumber,
    summary: `COD remitted for ${shipment.trackingNumber} (₦${shipment.codAmount})`,
  });
  res.json({ data: shipment });
});

export default { list, stats, track, get, create, updateStatus, assignRider, capturePod, remitCod };
