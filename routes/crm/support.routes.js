import { Router } from "express";
import * as ctrl from "../../controllers/crm/support.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  taskCommentSchema,
  taskListQuerySchema,
  logCommSchema,
  sendEmailSchema,
  commListQuerySchema,
} from "../../utils/validators/support.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant);

/* Tasks */
const taskRead = checkPermission("task:read");
const taskWrite = checkPermission("task:write");
router.get("/tasks/stats", taskRead, ctrl.taskStats);
router.get("/tasks", taskRead, validate(taskListQuerySchema, "query"), ctrl.listTasks);
router.post("/tasks", taskWrite, validate(createTaskSchema), ctrl.createTask);
router.get("/tasks/:id", taskRead, ctrl.getTask);
router.patch("/tasks/:id", taskWrite, validate(updateTaskSchema), ctrl.updateTask);
router.post("/tasks/:id/complete", taskWrite, validate(completeTaskSchema), ctrl.completeTask);
router.post("/tasks/:id/comments", taskWrite, validate(taskCommentSchema), ctrl.addTaskComment);

/* Communications */
router.get("/communications", checkPermission("communication:read"), validate(commListQuerySchema, "query"), ctrl.listComms);
router.post("/communications", checkPermission("communication:write"), validate(logCommSchema), ctrl.logComm);
router.delete("/communications/:id", checkPermission("communication:delete"), ctrl.deleteComm);
router.post("/emails/send", checkPermission("communication:write"), validate(sendEmailSchema), ctrl.sendEmail);

/* Sales */
router.get("/sales/overview", checkPermission("report:crm"), ctrl.salesOverview);

export default router;
