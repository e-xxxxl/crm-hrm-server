import { Router } from "express";
import * as ctrl from "../../controllers/crm/ticket.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createTicketSchema,
  ticketListQuerySchema,
  addUpdateSchema,
  assignSchema,
  statusSchema,
  prioritySchema,
  escalateSchema,
  dueDateSchema,
  watchSchema,
} from "../../utils/validators/ticket.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant);

const read = checkPermission("ticket:read");
const write = checkPermission("ticket:write");
const assignPerm = checkPermission("ticket:assign");
const escalatePerm = checkPermission("ticket:escalate");

router.get("/stats", read, ctrl.stats);
router.get("/", read, validate(ticketListQuerySchema, "query"), ctrl.list);
router.post("/", write, validate(createTicketSchema), ctrl.create);
router.get("/:id", read, ctrl.get);
router.post("/:id/updates", write, validate(addUpdateSchema), ctrl.addUpdate);
router.post("/:id/assign", assignPerm, validate(assignSchema), ctrl.assign);
router.post("/:id/status", write, validate(statusSchema), ctrl.changeStatus);
router.post("/:id/priority", write, validate(prioritySchema), ctrl.changePriority);
router.post("/:id/escalate", escalatePerm, validate(escalateSchema), ctrl.escalate);
router.post("/:id/due-date", assignPerm, validate(dueDateSchema), ctrl.setDueDate);
router.post("/:id/watch", read, validate(watchSchema), ctrl.watch);

export default router;
