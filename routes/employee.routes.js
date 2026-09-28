import { Router } from "express";
import * as ctrl from "../controllers/employee.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { z } from "zod";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeStatusSchema,
} from "../utils/validators/employee.validator.js";

const provisionLoginSchema = z.object({
  role: z.string().min(1),
  password: z.string().min(8).max(128).optional(),
});

const updateLoginSchema = z.object({
  email: z.string().email().optional(),
  role: z.string().min(1).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(128).optional(),
});

// Login view/edit/reset is restricted to exactly these three roles.
const ADMIN_ROLES = ["Super Admin", "Group Admin", "HR Manager"];

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("employee:read"), ctrl.list);
router.get("/:id", checkPermission("employee:read"), ctrl.get);
router.post("/", checkPermission("employee:write"), validate(createEmployeeSchema), ctrl.create);
router.patch("/:id", checkPermission("employee:write"), validate(updateEmployeeSchema), ctrl.update);
router.post(
  "/:id/login",
  checkPermission(["employee:write", "org:manage_members"]),
  validate(provisionLoginSchema),
  ctrl.provisionLogin,
);
router.patch(
  "/:id/status",
  checkPermission("employee:deactivate"),
  validate(employeeStatusSchema),
  ctrl.setStatus,
);
// Delete cascades through every record about the employee — Super Admin
// only (see employee.service.js deleteEmployee, which double-checks this).
// Group Admin and HR Manager can still edit and deactivate (see above).
router.delete("/:id", requireRole("Super Admin"), ctrl.remove);

// View/edit/reset an employee's platform login — same three roles.
router.get("/:id/login", requireRole(...ADMIN_ROLES), ctrl.getLogin);
router.patch("/:id/login", requireRole(...ADMIN_ROLES), validate(updateLoginSchema), ctrl.updateLogin);
router.post(
  "/:id/login/reset-password",
  requireRole(...ADMIN_ROLES),
  validate(resetPasswordSchema),
  ctrl.resetLoginPassword,
);

export default router;
