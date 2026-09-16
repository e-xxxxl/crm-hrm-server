import { Router } from "express";
import * as ctrl from "../controllers/department.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  departmentStatusSchema,
} from "../utils/validators/department.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

router.get("/", checkPermission("department:read"), ctrl.list);
router.get("/:id", checkPermission("department:read"), ctrl.get);
router.post("/", checkPermission("department:write"), validate(createDepartmentSchema), ctrl.create);
router.patch("/:id", checkPermission("department:write"), validate(updateDepartmentSchema), ctrl.update);
router.patch(
  "/:id/status",
  checkPermission("department:write"),
  validate(departmentStatusSchema),
  ctrl.setStatus,
);

export default router;
