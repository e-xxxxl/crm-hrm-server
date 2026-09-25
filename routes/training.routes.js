import { Router } from "express";
import * as ctrl from "../controllers/training.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { checkPermission, requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  createTrainingSchema,
  updateTrainingSchema,
  trainingActiveSchema,
  recordAttendanceSchema,
} from "../utils/validators/training.validator.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

// Catalog — creating a new training is Super Admin / Group Admin only, as
// requested; editing/deactivating/deleting an existing one is also open to
// HR Manager. Everyone with training:read can browse the catalog.
router.get("/", checkPermission("training:read"), ctrl.list);
router.post("/", checkPermission("training:write"), validate(createTrainingSchema), ctrl.create);
router.patch("/:id", requireRole("Super Admin", "Group Admin", "HR Manager"), validate(updateTrainingSchema), ctrl.update);
router.patch("/:id/active", requireRole("Super Admin", "Group Admin", "HR Manager"), validate(trainingActiveSchema), ctrl.setActive);
router.delete("/:id", requireRole("Super Admin", "Group Admin", "HR Manager"), ctrl.remove);

// Attendance — anyone who can view an employee's profile can see their
// training history; recording/removing it needs the same tier that already
// manages employee records. `/me` is the self-service view.
router.get("/attendance/me", checkPermission("training:read"), ctrl.listOwnAttendance);
router.get("/attendance", checkPermission("employee:read"), ctrl.listAttendance);
router.post("/attendance", checkPermission("employee:write"), validate(recordAttendanceSchema), ctrl.recordAttendance);
router.delete("/attendance/:id", checkPermission("employee:write"), ctrl.deleteAttendance);

export default router;
