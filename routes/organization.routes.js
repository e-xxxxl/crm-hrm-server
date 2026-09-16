import { Router } from "express";
import * as ctrl from "../controllers/organization.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  orgStatusSchema,
} from "../utils/validators/organization.validator.js";

const router = Router();

// Organization routes are not org-scoped in the usual way — a platform admin
// can see several. Authorization is enforced inside the service against the
// caller's role + active org.
router.use(verifyToken);

router.get("/", checkPermission("org:read"), ctrl.list);
router.get("/:id", checkPermission("org:read"), ctrl.get);
router.post("/", checkPermission("org:write"), validate(createOrganizationSchema), ctrl.create);
router.patch("/:id", checkPermission("org:write"), validate(updateOrganizationSchema), ctrl.update);
router.patch(
  "/:id/status",
  checkPermission("org:write"),
  validate(orgStatusSchema),
  ctrl.setStatus,
);

export default router;
