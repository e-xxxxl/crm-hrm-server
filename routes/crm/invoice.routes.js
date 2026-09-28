import { Router } from "express";
import * as ctrl from "../../controllers/crm/invoice.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceStatusSchema,
  sendInvoiceSchema,
} from "../../utils/validators/crmBrand.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant);

const read = checkPermission("invoice:read");
const write = checkPermission("invoice:write");

router.get("/", read, ctrl.list);
router.post("/", write, validate(createInvoiceSchema), ctrl.create);
router.get("/:id", read, ctrl.get);
router.patch("/:id", write, validate(updateInvoiceSchema), ctrl.update);
router.patch("/:id/status", write, validate(invoiceStatusSchema), ctrl.setStatus);
router.delete("/:id", write, ctrl.remove);
router.get("/:id/pdf", read, ctrl.pdf);
router.post("/:id/send", write, validate(sendInvoiceSchema), ctrl.send);

export default router;
