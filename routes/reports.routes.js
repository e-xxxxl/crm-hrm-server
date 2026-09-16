import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { scopeToTenant } from "../middleware/orgScope.js";
import { checkPermission } from "../middleware/rbac.js";
import { catchAsync } from "../utils/catchAsync.js";
import { hrReport } from "../services/reports.service.js";
import { supportReport, logisticsReport, groupDashboard } from "../services/crm/reports.service.js";

const router = Router();
router.use(verifyToken);

/* HRM consolidated report */
router.get(
  "/hr",
  scopeToOrg,
  checkPermission("report:hr"),
  catchAsync(async (req, res) => {
    res.json({ data: await hrReport(req.orgId, { month: req.query.month }) });
  }),
);

/* Group / brand executive dashboard */
router.get(
  "/group",
  scopeToOrg,
  checkPermission(["report:crm", "report:hr"], { mode: "any" }),
  catchAsync(async (req, res) => {
    res.json({ data: await groupDashboard(req.auth) });
  }),
);

/* CRM support desk report */
router.get(
  "/support",
  scopeToTenant,
  checkPermission("report:crm"),
  catchAsync(async (req, res) => {
    res.json({ data: await supportReport(req.tenantId, req.query) });
  }),
);

/* CRM logistics report */
router.get(
  "/logistics",
  scopeToTenant,
  checkPermission("report:crm"),
  catchAsync(async (req, res) => {
    res.json({ data: await logisticsReport(req.tenantId, req.query) });
  }),
);

export default router;
