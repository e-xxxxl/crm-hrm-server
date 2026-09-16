import { AppError } from "../utils/AppError.js";
import { getCurrentBrand } from "../services/crm/brand.service.js";

/**
 * Guard a brand-module route so it only serves the organization whose brand is
 * of the expected kind. Runs after scopeToTenant. Attaches `req.brand`.
 *
 *   router.use(verifyToken, scopeToTenant, requireBrandKind("courier"));
 */
export function requireBrandKind(...kinds) {
  return async function guard(req, _res, next) {
    try {
      const brand = await getCurrentBrand(req.tenantId);
      if (!kinds.includes(brand.kind)) {
        return next(
          AppError.forbidden(
            `This module is not available for a ${brand.kind} brand`,
            { code: "WRONG_BRAND_KIND" },
          ),
        );
      }
      req.brand = brand;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export default requireBrandKind;
