import { Invoice } from "../../models/crm/Invoice.js";
import { Customer } from "../../models/crm/Customer.js";
import { Organization } from "../../models/hrm/Organization.js";
import { nextCode } from "../../models/crm/Counter.js";
import { AppError } from "../../utils/AppError.js";
import { hasPermission } from "../../utils/permissions.js";
import { parsePagination, paginated } from "../../utils/query.js";
import { generateInvoicePdf } from "../pdf.service.js";
import { sendEmail } from "./email.service.js";

function formatAddress(a) {
  if (!a) return undefined;
  return [a.line1, a.line2, a.city, a.state].filter(Boolean).join(", ") || undefined;
}

async function snapshotCustomer(tenantId, customerId) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw AppError.badRequest("Unknown customer");
  const address = (customer.addresses || []).find((a) => a.isDefault) || customer.addresses?.[0];
  return {
    customer,
    snapshot: {
      name: customer.displayName,
      email: customer.primaryEmail,
      phone: customer.primaryPhone,
      address: formatAddress(address),
    },
  };
}

export async function listInvoices(tenantId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { tenantId };
  if (query.status) filter.status = query.status;
  if (query.kind) filter.kind = query.kind;
  if (query.customer) filter.customer = query.customer;
  const [items, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("customer", "firstName lastName businessName type"),
    Invoice.countDocuments(filter),
  ]);
  return paginated(items, total, { page, limit });
}

export async function getInvoice(tenantId, id) {
  const invoice = await Invoice.findOne({ _id: id, tenantId }).populate("customer", "firstName lastName businessName type");
  if (!invoice) throw AppError.notFound("Invoice not found");
  return invoice;
}

export async function createInvoice(tenantId, actor, input) {
  const { snapshot } = await snapshotCustomer(tenantId, input.customer);
  const kind = input.kind === "receipt" ? "receipt" : "invoice";
  const number = await nextCode(kind === "receipt" ? "RCT" : "INV", `${tenantId}:invoice`, 5);

  const invoice = new Invoice({
    tenantId,
    number,
    kind,
    customer: input.customer,
    customerSnapshot: snapshot,
    lineItems: input.lineItems || [],
    currency: input.currency || "NGN",
    taxRate: input.taxRate || 0,
    notes: input.notes,
    dueDate: input.dueDate,
    status: kind === "receipt" ? "paid" : "draft",
    paidAt: kind === "receipt" ? new Date() : undefined,
    createdBy: actor.userId,
  });
  await invoice.save();
  return invoice;
}

export async function updateInvoice(tenantId, id, input) {
  const invoice = await Invoice.findOne({ _id: id, tenantId });
  if (!invoice) throw AppError.notFound("Invoice not found");
  if (invoice.status === "void") throw AppError.badRequest("This invoice has been voided");

  const editable = ["lineItems", "taxRate", "notes", "dueDate"];
  for (const f of editable) if (input[f] !== undefined) invoice[f] = input[f];
  await invoice.save();
  return invoice;
}

export async function setInvoiceStatus(tenantId, id, status) {
  const invoice = await Invoice.findOne({ _id: id, tenantId });
  if (!invoice) throw AppError.notFound("Invoice not found");
  invoice.status = status;
  if (status === "paid") invoice.paidAt = new Date();
  await invoice.save();
  return invoice;
}

/**
 * A regular `invoice:write` holder can only delete a still-draft document —
 * once it's sent or paid, void it instead so the record (and any money
 * already collected) stays traceable. Super Admin can delete regardless of
 * status; this is also the only way to delete a *receipt*, since receipts
 * are created already "paid" (there's no draft stage for money already in
 * hand) and would otherwise be permanently undeletable by anyone.
 */
export async function deleteInvoice(tenantId, id, actor) {
  const invoice = await Invoice.findOne({ _id: id, tenantId });
  if (!invoice) throw AppError.notFound("Invoice not found");
  const isSuperAdmin = hasPermission(actor?.permissions, "*");
  if (!isSuperAdmin && (invoice.status === "sent" || invoice.status === "paid")) {
    throw AppError.badRequest("Cannot delete an invoice that's already been sent or paid — void it instead, or ask a Super Admin to delete it");
  }
  await invoice.deleteOne();
  return { ok: true };
}

async function pdfFor(tenantId, invoice) {
  const org = await Organization.findById(tenantId);
  return generateInvoicePdf(invoice.toJSON ? invoice.toJSON() : invoice, org);
}

export async function invoicePdf(tenantId, id) {
  const invoice = await getInvoice(tenantId, id);
  return { invoice, pdf: await pdfFor(tenantId, invoice) };
}

/** Email the invoice PDF to the customer's address (or an override), then mark it sent. */
export async function sendInvoice(tenantId, id, { to } = {}) {
  const invoice = await getInvoice(tenantId, id);
  const org = await Organization.findById(tenantId);
  const recipient = to || invoice.customerSnapshot?.email;
  if (!recipient) throw AppError.badRequest("This customer has no email on file — provide one to send to");

  const pdf = await pdfFor(tenantId, invoice);
  const label = invoice.kind === "receipt" ? "Receipt" : "Invoice";
  await sendEmail(org?.code, {
    to: recipient,
    subject: `${label} ${invoice.number} from ${org?.name || "us"}`,
    html: `<p>Hi ${invoice.customerSnapshot?.name || "there"},</p><p>Please find your ${label.toLowerCase()} attached.</p><p>Total: ${invoice.currency} ${invoice.total.toLocaleString("en-NG")}</p>`,
    attachments: [{ filename: `${invoice.number}.pdf`, content: pdf }],
  });

  invoice.status = invoice.kind === "receipt" ? invoice.status : "sent";
  invoice.sentAt = new Date();
  invoice.sentTo = recipient;
  await invoice.save();
  return invoice;
}

export default {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  setInvoiceStatus,
  deleteInvoice,
  invoicePdf,
  sendInvoice,
};
