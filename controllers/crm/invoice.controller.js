import * as service from "../../services/crm/invoice.service.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { recordAudit } from "../../services/audit.service.js";

export const list = catchAsync(async (req, res) => {
  res.json(await service.listInvoices(req.tenantId, req.query));
});

export const get = catchAsync(async (req, res) => {
  res.json({ data: await service.getInvoice(req.tenantId, req.params.id) });
});

export const create = catchAsync(async (req, res) => {
  const invoice = await service.createInvoice(req.tenantId, req.auth, req.body);
  await recordAudit(req, {
    action: "invoice.create",
    entityType: "Invoice",
    entityId: invoice._id,
    entityLabel: invoice.number,
    summary: `Created ${invoice.kind} ${invoice.number}`,
  });
  res.status(201).json({ data: invoice });
});

export const update = catchAsync(async (req, res) => {
  const invoice = await service.updateInvoice(req.tenantId, req.params.id, req.body);
  await recordAudit(req, { action: "invoice.update", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, summary: `Updated ${invoice.number}` });
  res.json({ data: invoice });
});

export const setStatus = catchAsync(async (req, res) => {
  const invoice = await service.setInvoiceStatus(req.tenantId, req.params.id, req.body.status);
  await recordAudit(req, { action: "invoice.status", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, summary: `Marked ${invoice.number} as ${invoice.status}` });
  res.json({ data: invoice });
});

export const remove = catchAsync(async (req, res) => {
  await service.deleteInvoice(req.tenantId, req.params.id);
  await recordAudit(req, { action: "invoice.delete", entityType: "Invoice", entityId: req.params.id, summary: "Deleted an invoice" });
  res.json({ data: { ok: true } });
});

export const pdf = catchAsync(async (req, res) => {
  const { invoice, pdf: buf } = await service.invoicePdf(req.tenantId, req.params.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${invoice.number}.pdf"`);
  res.send(buf);
});

export const send = catchAsync(async (req, res) => {
  const invoice = await service.sendInvoice(req.tenantId, req.params.id, req.body);
  await recordAudit(req, { action: "invoice.send", entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.number, summary: `Emailed ${invoice.number} to ${invoice.sentTo}` });
  res.json({ data: invoice });
});

export default { list, get, create, update, setStatus, remove, pdf, send };
