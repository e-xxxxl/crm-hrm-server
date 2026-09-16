import { HrDocument } from "../models/hrm/HrDocument.js";
import { PerformanceReview } from "../models/hrm/PerformanceReview.js";
import { Target } from "../models/hrm/Target.js";
import { Organization } from "../models/hrm/Organization.js";
import { notify } from "./notification.service.js";
import { sweepSla } from "./crm/ticket.service.js";
import { sweepTaskReminders } from "./crm/task.service.js";
import { logger } from "../utils/logger.js";

const DAY = 86400000;

/**
 * Daily HR housekeeping: refresh derived statuses and fire threshold-based
 * notifications (contract expiry 30/14/7, reviews due, targets due). Idempotent
 * — each alert threshold fires at most once (tracked on the document / a marker).
 */
export async function runDailyHrChecks({ organizationId } = {}) {
  const orgFilter = organizationId ? { _id: organizationId } : {};
  const orgs = await Organization.find({ ...orgFilter, status: "active" }).select("_id settings name");
  const report = { organizations: 0, documentAlerts: 0, reviewAlerts: 0, targetAlerts: 0, slaBreaches: 0, taskReminders: 0 };

  for (const org of orgs) {
    report.organizations += 1;
    const thresholds = org.settings?.contractAlertDays?.length ? org.settings.contractAlertDays : [30, 14, 7];

    // ---- CRM sweeps: ticket SLA + task reminders ----
    try {
      report.slaBreaches += await sweepSla(org._id);
    } catch (err) {
      logger.warn(`[maintenance] SLA sweep failed for ${org.name}: ${err.message}`);
    }
    try {
      report.taskReminders = (report.taskReminders || 0) + (await sweepTaskReminders(org._id));
    } catch (err) {
      logger.warn(`[maintenance] task reminder sweep failed for ${org.name}: ${err.message}`);
    }

    // ---- Document expiry ----
    const docs = await HrDocument.find({
      organizationId: org._id,
      status: { $ne: "archived" },
      expiryDate: { $ne: null },
    }).populate("employee", "firstName lastName employeeId");

    for (const doc of docs) {
      const daysLeft = Math.ceil((doc.expiryDate - Date.now()) / DAY);
      doc.refreshStatus();
      let changed = doc.isModified("status");

      for (const t of thresholds) {
        if (daysLeft <= t && daysLeft >= 0 && !doc.alertsSent.includes(t)) {
          doc.alertsSent.push(t);
          changed = true;
          report.documentAlerts += 1;
          await notify(org._id, {
            to: { role: "HR Manager" },
            type: "contract.expiring",
            title: `Document expiring in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
            body: `${doc.name}${doc.employee ? ` — ${doc.employee.firstName} ${doc.employee.lastName}` : ""}`,
            link: `/hrm/documents?highlight=${doc._id}`,
          });
        }
      }
      if (daysLeft < 0 && !doc.alertsSent.includes(0)) {
        doc.alertsSent.push(0);
        changed = true;
        report.documentAlerts += 1;
        await notify(org._id, {
          to: { role: "HR Manager" },
          type: "contract.expiring",
          title: "Document has expired",
          body: `${doc.name}${doc.employee ? ` — ${doc.employee.firstName} ${doc.employee.lastName}` : ""}`,
          link: `/hrm/documents?highlight=${doc._id}`,
        });
      }
      if (changed) await doc.save();
    }

    // ---- Reviews due within 7 days ----
    const dueReviews = await PerformanceReview.find({
      organizationId: org._id,
      status: { $nin: ["completed", "acknowledged"] },
      dueDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * DAY) },
    }).populate("employee reviewer", "firstName lastName");
    for (const review of dueReviews) {
      if (!review.reviewer?._id) continue;
      report.reviewAlerts += 1;
      await notify(org._id, {
        to: { employee: review.reviewer._id },
        type: "review.due",
        title: "Performance review due soon",
        body: `${review.cycle} review for ${review.employee?.firstName} ${review.employee?.lastName}`,
        link: `/hrm/performance/${review._id}`,
      });
    }

    // ---- Targets due within 3 days ----
    const dueTargets = await Target.find({
      organizationId: org._id,
      status: { $in: ["not_started", "in_progress", "at_risk"] },
      deadline: { $gte: new Date(), $lte: new Date(Date.now() + 3 * DAY) },
      employee: { $ne: null },
    }).select("title deadline employee");
    for (const target of dueTargets) {
      report.targetAlerts += 1;
      await notify(org._id, {
        to: { employee: target.employee },
        type: "target.deadline",
        title: "Target deadline approaching",
        body: `"${target.title}" is due ${new Date(target.deadline).toLocaleDateString("en-NG")}`,
        link: `/hrm/targets/${target._id}`,
      });
    }
  }

  logger.info(
    `[maintenance] HR checks — ${report.organizations} org(s), ` +
      `${report.documentAlerts} document, ${report.reviewAlerts} review, ${report.targetAlerts} target alerts, ` +
      `${report.slaBreaches} ticket SLA breach(es)`,
  );
  return report;
}

let timer = null;
/** Start a lightweight in-process daily scheduler (dev / single-instance). */
export function startHrScheduler() {
  if (timer) return;
  const tick = () => {
    runDailyHrChecks().catch((err) => logger.error("[maintenance] failed:", err.message));
  };
  // First run 60s after boot, then every 24h.
  setTimeout(tick, 60_000);
  timer = setInterval(tick, 24 * 60 * 60 * 1000);
  timer.unref?.();
}

export default { runDailyHrChecks, startHrScheduler };
