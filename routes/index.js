import { Router } from "express";
import authRoutes from "./auth.routes.js";
import organizationRoutes from "./organization.routes.js";
import branchRoutes from "./branch.routes.js";
import departmentRoutes from "./department.routes.js";
import employeeRoutes from "./employee.routes.js";
import hrOverviewRoutes from "./hrOverview.routes.js";
import attendanceRoutes from "./attendance.routes.js";
import leaveRoutes from "./leave.routes.js";
import notificationRoutes from "./notification.routes.js";
import payrollRoutes from "./payroll.routes.js";
import performanceRoutes from "./performance.routes.js";
import targetRoutes from "./target.routes.js";
import recruitmentRoutes from "./recruitment.routes.js";
import documentRoutes from "./document.routes.js";
import disciplinaryRoutes from "./disciplinary.routes.js";
import fileRoutes from "./file.routes.js";
import maintenanceRoutes from "./maintenance.routes.js";
import reportsRoutes from "./reports.routes.js";
import settingsRoutes from "./settings.routes.js";
import brandRoutes from "./crm/brand.routes.js";
import customerRoutes from "./crm/customer.routes.js";
import ticketRoutes from "./crm/ticket.routes.js";
import shipmentRoutes from "./crm/shipment.routes.js";
import orderRoutes from "./crm/order.routes.js";
import marketplaceRoutes from "./crm/marketplace.routes.js";
import riderRoutes from "./crm/rider.routes.js";
import crmSupportRoutes from "./crm/support.routes.js";
import auditRoutes from "./audit.routes.js";
import syncRoutes from "./crm/sync.routes.js";

/**
 * Central router. Feature route modules are mounted here and the tree is
 * attached under /api in server.js. New phases add one line each.
 */
const api = Router();

api.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

api.use("/auth", authRoutes);
api.use("/organizations", organizationRoutes);
api.use("/hrm/branches", branchRoutes);
api.use("/hrm/departments", departmentRoutes);
api.use("/hrm/employees", employeeRoutes);
api.use("/hrm/overview", hrOverviewRoutes);
api.use("/hrm/attendance", attendanceRoutes);
api.use("/hrm/leave", leaveRoutes);
api.use("/hrm/notifications", notificationRoutes);
api.use("/hrm/payroll", payrollRoutes);
api.use("/hrm/performance", performanceRoutes);
api.use("/hrm/targets", targetRoutes);
api.use("/hrm/recruitment", recruitmentRoutes);
api.use("/hrm/documents", documentRoutes);
api.use("/hrm/disciplinary", disciplinaryRoutes);
api.use("/hrm/files", fileRoutes);
api.use("/hrm/maintenance", maintenanceRoutes);
api.use("/hrm/reports", reportsRoutes);
api.use("/reports", reportsRoutes);
api.use("/hrm/settings", settingsRoutes);
api.use("/crm/brands", brandRoutes);
api.use("/crm/customers", customerRoutes);
api.use("/crm/tickets", ticketRoutes);
api.use("/crm/shipments", shipmentRoutes);
api.use("/crm/orders", orderRoutes);
api.use("/crm/marketplace", marketplaceRoutes);
api.use("/crm/riders", riderRoutes);
api.use("/crm", crmSupportRoutes);
api.use("/audit", auditRoutes);
api.use("/crm/sync", syncRoutes);

export default api;
