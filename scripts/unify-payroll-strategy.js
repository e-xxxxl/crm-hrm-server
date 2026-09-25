/**
 * One-time migration: switch QuickShipAfrica and 9jaTradiesPages onto the
 * same allowance-based salary structure as AJCL (Basic, Housing, Transport,
 * Subsidy, Data allowance, Ex gratia, Referral bonus), per explicit request.
 *
 * Consequences, done deliberately:
 * - QuickShipAfrica moves off "hybrid" — trip-per-commission pay stops being
 *   calculated going forward. Existing `basic` values are left as-is.
 * - 9jaTradiesPages moves off "fixed-monthly" — a single grossMonthly no
 *   longer drives pay. To avoid silently zeroing anyone's pay, each current
 *   structure's grossMonthly is copied into `basic` (HR can redistribute
 *   into the other allowance fields afterward).
 * - Only *current* salary structures are touched; historical (closed)
 *   structures and past payroll runs are left untouched — they keep the
 *   strategy that was actually in effect when they were run.
 *
 *   node scripts/unify-payroll-strategy.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { Organization } from "../models/hrm/Organization.js";
import { SalaryStructure } from "../models/hrm/SalaryStructure.js";

const TARGET_CODES = ["QSA", "NTP"];

export async function unifyPayrollStrategy() {
  for (const code of TARGET_CODES) {
    const org = await Organization.findOne({ code });
    if (!org) {
      logger.warn(`${code}: organization not found, skipping`);
      continue;
    }

    const previousStrategy = org.payrollStrategy;
    if (previousStrategy === "allowance-based") {
      logger.info(`${org.name} (${code}): already allowance-based`);
      continue;
    }

    org.payrollStrategy = "allowance-based";
    await org.save();

    // Preserve pay level for anyone whose whole gross lived in one field
    // that the allowance-based engine no longer reads.
    const structures = await SalaryStructure.find({ organizationId: org._id, isCurrent: true });
    let migrated = 0;
    for (const s of structures) {
      if (previousStrategy === "fixed-monthly" && s.grossMonthly > 0 && !s.basic) {
        s.basic = s.grossMonthly;
        s.grossMonthly = 0;
        await s.save();
        migrated += 1;
      }
    }

    logger.info(
      `${org.name} (${code}): ${previousStrategy} -> allowance-based, ${migrated} current salary structure(s) migrated`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("unify-payroll-strategy.js")) {
  (async () => {
    try {
      await connectDatabases();
      await unifyPayrollStrategy();
      logger.info("done");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("unify-payroll-strategy failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
