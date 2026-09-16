import { Brand } from "../../models/crm/Brand.js";
import { Organization } from "../../models/hrm/Organization.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Map an organization to its default CRM brand configuration. The three known
 * organizations get their brand module wired up; anything else is generic.
 */
function defaultBrandFor(org) {
  const byCode = {
    NTP: { kind: "marketplace", ticketPrefix: "9JT", codEnabled: false, slaHours: 24 },
    QSA: { kind: "logistics", ticketPrefix: "QSA", trackingPrefix: "QSA", codEnabled: true, slaHours: 24 },
    AJCL: { kind: "courier", ticketPrefix: "AJC", trackingPrefix: "AJCL", codEnabled: true, slaHours: 48 },
  };
  const cfg = byCode[org.code] || { kind: "generic", ticketPrefix: "TKT", codEnabled: false, slaHours: 48 };
  return {
    tenantId: org._id,
    organizationName: org.name,
    name: org.name,
    slug: org.slug,
    code: org.code,
    kind: cfg.kind,
    logoUrl: org.logoUrl,
    supportChannels: { email: org.email, phone: org.phone, website: org.website },
    settings: {
      trackingPrefix: cfg.trackingPrefix,
      ticketPrefix: cfg.ticketPrefix,
      codEnabled: cfg.codEnabled,
      slaHours: cfg.slaHours,
    },
    status: org.status,
  };
}

/** Create any missing brand records for existing organizations. Idempotent. */
export async function ensureBrands() {
  const orgs = await Organization.find();
  let created = 0;
  for (const org of orgs) {
    const exists = await Brand.exists({ tenantId: org._id });
    if (!exists) {
      await Brand.create(defaultBrandFor(org));
      created += 1;
    }
  }
  return { created, total: orgs.length };
}

/** The brand for the active tenant, auto-provisioned on first access. */
export async function getCurrentBrand(tenantId) {
  let brand = await Brand.findOne({ tenantId });
  if (!brand) {
    const org = await Organization.findById(tenantId);
    if (!org) throw AppError.notFound("Organization not found");
    brand = await Brand.create(defaultBrandFor(org));
  }
  return brand;
}

export async function listBrands() {
  return Brand.find().sort({ name: 1 });
}

export async function updateBrand(tenantId, input) {
  const brand = await getCurrentBrand(tenantId);
  const editable = [
    "name",
    "description",
    "logoUrl",
    "primaryColor",
    "supportChannels",
    "status",
  ];
  for (const key of editable) {
    if (input[key] !== undefined) brand[key] = input[key];
  }
  if (input.settings) {
    brand.settings = { ...brand.settings.toObject?.(), ...input.settings };
    brand.markModified("settings");
  }
  await brand.save();
  return brand;
}

export default { ensureBrands, getCurrentBrand, listBrands, updateBrand };
