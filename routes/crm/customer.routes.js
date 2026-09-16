import { Router } from "express";
import * as ctrl from "../../controllers/crm/customer.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerListQuerySchema,
  customerSearchQuerySchema,
  customerNoteSchema,
  customerStatusSchema,
} from "../../utils/validators/crm.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant);

const read = checkPermission("customer:read");
const write = checkPermission("customer:write");

router.get("/search", read, validate(customerSearchQuerySchema, "query"), ctrl.search);
router.get("/segments", read, ctrl.segments);
router.get("/", read, validate(customerListQuerySchema, "query"), ctrl.list);
router.post("/", write, validate(createCustomerSchema), ctrl.create);
router.get("/:id", read, ctrl.get);
router.get("/:id/360", read, ctrl.overview);
router.patch("/:id", write, validate(updateCustomerSchema), ctrl.update);
router.post("/:id/notes", write, validate(customerNoteSchema), ctrl.addNote);
router.patch("/:id/status", write, validate(customerStatusSchema), ctrl.setStatus);

export default router;
