import { Router } from "express";
import * as ctrl from "../../controllers/crm/marketplace.controller.js";
import { verifyToken } from "../../middleware/auth.js";
import { scopeToTenant } from "../../middleware/orgScope.js";
import { requireBrandKind } from "../../middleware/brandKind.js";
import { checkPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  createBusinessSchema,
  updateBusinessSchema,
  moderateBusinessSchema,
  subscriptionSchema,
  createLeadSchema,
  leadStageSchema,
  leadActivitySchema,
  assignLeadSchema,
  createReviewSchema,
  moderateReviewSchema,
  reviewResponseSchema,
} from "../../utils/validators/crmBrand.validator.js";

const router = Router();
router.use(verifyToken, scopeToTenant, requireBrandKind("marketplace"));

/* Businesses */
const bizRead = checkPermission("business:read");
const bizWrite = checkPermission("business:write");
const bizMod = checkPermission("business:moderate");
router.get("/businesses/stats", bizRead, ctrl.businessStats);
router.get("/businesses", bizRead, ctrl.listBusinesses);
router.post("/businesses", bizWrite, validate(createBusinessSchema), ctrl.createBusiness);
router.get("/businesses/:id", bizRead, ctrl.getBusiness);
router.patch("/businesses/:id", bizWrite, validate(updateBusinessSchema), ctrl.updateBusiness);
router.post("/businesses/:id/moderate", bizMod, validate(moderateBusinessSchema), ctrl.moderateBusiness);
router.post("/businesses/:id/subscription", bizMod, validate(subscriptionSchema), ctrl.setSubscription);

/* Leads */
const leadRead = checkPermission("lead:read");
const leadWrite = checkPermission("lead:write");
router.get("/leads/board", leadRead, ctrl.leadBoard);
router.get("/leads/stats", leadRead, ctrl.leadStats);
router.get("/leads", leadRead, ctrl.listLeads);
router.post("/leads", leadWrite, validate(createLeadSchema), ctrl.createLead);
router.get("/leads/:id", leadRead, ctrl.getLead);
router.post("/leads/:id/stage", leadWrite, validate(leadStageSchema), ctrl.moveLeadStage);
router.post("/leads/:id/activity", leadWrite, validate(leadActivitySchema), ctrl.addLeadActivity);
router.post("/leads/:id/assign", leadWrite, validate(assignLeadSchema), ctrl.assignLead);

/* Reviews */
const revRead = checkPermission("review:read");
const revMod = checkPermission("review:moderate");
router.get("/reviews", revRead, ctrl.listReviews);
router.post("/reviews", checkPermission(["review:moderate", "business:write"], { mode: "any" }), validate(createReviewSchema), ctrl.createReview);
router.post("/reviews/:id/moderate", revMod, validate(moderateReviewSchema), ctrl.moderateReview);
router.post("/reviews/:id/response", revMod, validate(reviewResponseSchema), ctrl.respondToReview);

export default router;
