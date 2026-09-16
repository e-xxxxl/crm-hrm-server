import { AppError } from "../utils/AppError.js";

/**
 * scopeToOrg — third link in the auth chain. Must run after verifyToken.
 *
 * Exposes the active organization id and a set of helpers that every HRM
 * service uses so no query is ever written without an org filter:
 *
 *   req.orgId                     → ObjectId string of the active org
 *   req.scoped(extra?)            → { organizationId, ...extra } filter object
 *   req.assertSameOrg(doc)        → throws 404 if doc belongs to another org
 *   req.withOrg(payload)          → payload with organizationId stamped in
 *
 * The CRM equivalent stamps `tenantId`; that variant is added in Phase 7.
 */
export function scopeToOrg(req, _res, next) {
  if (!req.auth || !req.auth.organizationId) {
    return next(AppError.unauthorized("No active organization on this session"));
  }

  const orgId = req.auth.organizationId;
  req.orgId = orgId;

  req.scoped = (extra = {}) => ({ organizationId: orgId, ...extra });

  req.withOrg = (payload = {}) => ({ ...payload, organizationId: orgId });

  req.assertSameOrg = (doc) => {
    if (!doc) throw AppError.notFound();
    const docOrg = String(doc.organizationId?._id ?? doc.organizationId ?? "");
    if (docOrg !== String(orgId)) {
      // Do not reveal that the record exists in another org.
      throw AppError.notFound();
    }
    return doc;
  };

  next();
}

/**
 * scopeToTenant — CRM equivalent of scopeToOrg. Every CRM document carries a
 * `tenantId`, which is the same value as the active organization id (each of the
 * three organizations is exactly one CRM tenant / brand). Runs after verifyToken.
 *
 *   req.tenantId                  → ObjectId string of the active tenant
 *   req.tenantScoped(extra?)      → { tenantId, ...extra } filter object
 *   req.withTenant(payload)       → payload with tenantId stamped in
 *   req.assertSameTenant(doc)     → throws 404 if doc belongs to another tenant
 */
export function scopeToTenant(req, _res, next) {
  if (!req.auth || !req.auth.organizationId) {
    return next(AppError.unauthorized("No active organization on this session"));
  }
  const tenantId = req.auth.organizationId;
  req.tenantId = tenantId;
  req.orgId = tenantId;

  req.tenantScoped = (extra = {}) => ({ tenantId, ...extra });
  req.withTenant = (payload = {}) => ({ ...payload, tenantId });
  req.assertSameTenant = (doc) => {
    if (!doc) throw AppError.notFound();
    const docTenant = String(doc.tenantId?._id ?? doc.tenantId ?? "");
    if (docTenant !== String(tenantId)) throw AppError.notFound();
    return doc;
  };

  next();
}

/** Convenience: the standard HRM guard chain applied to a whole router. */
export function hrmContext() {
  return [scopeToOrg];
}

export default { scopeToOrg, scopeToTenant, hrmContext };
