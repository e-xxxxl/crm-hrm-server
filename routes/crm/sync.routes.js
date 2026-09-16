import { Router } from "express";
import { z } from "zod";
import * as ctrl from "../../controllers/crm/sync.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { requireBrandKind } from "../../middleware/brandKind.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";

const runSchema = z.object({ limit: z.coerce.number().int().positive().max(20000).optional() });

const router = Router();
router.use(verifyToken, scopeToTenant);

// Importing real customer/transaction data from a brand's own live system is
// an admin-grade action — gated tighter than ordinary CRM writes.
const admin = checkPermission(["settings:write", "org:write"], { mode: "any" });

router.get("/status", admin, ctrl.status);
router.post("/ajcl", admin, requireBrandKind("courier"), validate(runSchema), ctrl.runAjcl);
router.post("/quickship", admin, requireBrandKind("logistics"), validate(runSchema), ctrl.runQuickShip);
router.post("/tradies", admin, requireBrandKind("marketplace"), validate(runSchema), ctrl.runTradies);

export default router;
