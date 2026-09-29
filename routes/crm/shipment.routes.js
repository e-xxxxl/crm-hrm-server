import { Router } from "express";
import * as ctrl from "../../controllers/crm/shipment.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { requireBrandKind } from "../../middleware/brandKind.js";
import { checkPermission, requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createShipmentSchema,
  shipmentStatusSchema,
  assignRiderSchema,
  podSchema,
} from "../../utils/validators/crmBrand.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant, requireBrandKind("courier"));

const read = checkPermission("shipment:read");
const write = checkPermission("shipment:write");
const dispatch = checkPermission("shipment:dispatch");

router.get("/stats", read, ctrl.stats);
router.get("/track/:trackingNumber", read, ctrl.track);
router.get("/", read, ctrl.list);
router.post("/", write, validate(createShipmentSchema), ctrl.create);
router.get("/:id", read, ctrl.get);
router.post("/:id/status", write, validate(shipmentStatusSchema), ctrl.updateStatus);
router.post("/:id/assign-rider", dispatch, validate(assignRiderSchema), ctrl.assignRider);
router.post("/:id/pod", write, validate(podSchema), ctrl.capturePod);
router.post("/:id/remit-cod", checkPermission(["shipment:cod", "shipment:dispatch"], { mode: "any" }), ctrl.remitCod);
router.delete("/:id", requireRole("Super Admin"), ctrl.remove);

export default router;
