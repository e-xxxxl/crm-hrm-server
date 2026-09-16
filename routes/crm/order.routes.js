import { Router } from "express";
import * as ctrl from "../../controllers/crm/order.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { requireBrandKind } from "../../middleware/brandKind.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createOrderSchema,
  requoteSchema,
  quoteSchema,
  orderStatusSchema,
  orderPaymentSchema,
  assignRiderSchema,
} from "../../utils/validators/crmBrand.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant, requireBrandKind("logistics"));

const read = checkPermission("order:read");
const write = checkPermission("order:write");
const dispatch = checkPermission("order:dispatch");

router.get("/stats", read, ctrl.stats);
router.post("/quote", read, validate(quoteSchema), ctrl.quote);
router.get("/", read, ctrl.list);
router.post("/", write, validate(createOrderSchema), ctrl.create);
router.get("/:id", read, ctrl.get);
router.post("/:id/requote", write, validate(requoteSchema), ctrl.requote);
router.post("/:id/confirm", write, ctrl.confirm);
router.post("/:id/payment", write, validate(orderPaymentSchema), ctrl.payment);
router.post("/:id/status", write, validate(orderStatusSchema), ctrl.updateStatus);
router.post("/:id/assign-rider", dispatch, validate(assignRiderSchema), ctrl.assignRider);

export default router;
