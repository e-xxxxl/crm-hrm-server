import { Router } from "express";
import * as ctrl from "../controllers/employee.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
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
// Route-level check is broad; the service itself refuses anyone but a Super
// Admin (see employee.service.js deleteEmployee).
router.delete("/:id", checkPermission("employee:deactivate"), ctrl.remove);

export default router;
