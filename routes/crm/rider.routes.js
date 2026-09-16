import { Router } from "express";
import * as ctrl from "../../controllers/crm/rider.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { requireBrandKind } from "../../middleware/brandKind.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createRiderSchema,
  updateRiderSchema,
  provisionRiderLoginSchema,
  optimizeSchema,
  riderLocationSchema,
  availabilitySchema,
  riderActionSchema,
} from "../../utils/validators/rider.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant, requireBrandKind("courier", "logistics"));

const read = checkPermission("rider:read");
const write = checkPermission("rider:write");
const dispatch = checkPermission(["shipment:dispatch", "order:dispatch", "rider:write"], { mode: "any" });
const job = checkPermission("rider:job");

/* ---- Rider PWA (self) — declared before /:id so "me" isn't treated as an id ---- */
router.get("/me/dashboard", job, ctrl.myDashboard);
router.get("/me/jobs/:id", job, ctrl.myJob);
router.post("/me/jobs/:id/:action", job, validate(riderActionSchema), ctrl.jobAction);
router.post("/me/location", job, validate(riderLocationSchema), ctrl.updateLocation);
router.post("/me/availability", job, validate(availabilitySchema), ctrl.setAvailability);

/* ---- Dispatch ---- */
router.get("/dispatch/board", dispatch, ctrl.board);
router.get("/dispatch/map", dispatch, ctrl.map);
router.post("/dispatch/optimize", dispatch, validate(optimizeSchema), ctrl.optimize);

/* ---- Rider directory ---- */
router.get("/", read, ctrl.list);
router.post("/", write, validate(createRiderSchema), ctrl.create);
router.get("/:id", read, ctrl.get);
router.patch("/:id", write, validate(updateRiderSchema), ctrl.update);
router.post("/:id/login", write, validate(provisionRiderLoginSchema), ctrl.provisionLogin);

export default router;
