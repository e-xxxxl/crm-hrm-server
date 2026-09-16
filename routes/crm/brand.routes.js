import { Router } from "express";
import * as ctrl from "../../controllers/crm/brand.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { updateBrandSchema } from "../../utils/validators/crm.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant);

router.get("/current", checkPermission(["customer:read", "org:read"], { mode: "any" }), ctrl.current);
router.get("/", checkPermission(["customer:read", "org:read"], { mode: "any" }), ctrl.list);
router.patch("/current", checkPermission("settings:write"), validate(updateBrandSchema), ctrl.update);

export default router;
