/**
 * One-time fix for the live bug: a leave type's defaultDaysPerYear was
 * edited (e.g. Annual Leave 20 -> 15) but every employee's current-year
 * LeaveBalance had already been created with the old number and was never
 * updated — see leaveType.service.js#updateLeaveType, which now keeps this
 * in sync going forward. This corrects what's already out of sync right
 * now: every current-year balance is set to match its leave type's current
 * defaultDaysPerYear.
 *
 *   node scripts/sync-leave-balances.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { LeaveType } from "../models/hrm/LeaveType.js";
import { LeaveBalance } from "../models/hrm/LeaveBalance.js";

export async function syncLeaveBalances() {
  const year = new Date().getFullYear();
  const types = await LeaveType.find();
  let totalUpdated = 0;

  for (const t of types) {
    const result = await LeaveBalance.updateMany(
      { leaveType: t._id, year, entitledDays: { $ne: t.defaultDaysPerYear } },
      { $set: { entitledDays: t.defaultDaysPerYear } },
    );
    const updated = result.modifiedCount ?? result.nModified ?? 0;
    if (updated > 0) {
      logger.info(`${t.name} (org ${t.organizationId}): ${updated} balance(s) synced to ${t.defaultDaysPerYear} days`);
      totalUpdated += updated;
    }
  }

  logger.info(`Done — ${totalUpdated} balance(s) synced across ${types.length} leave type(s)`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync-leave-balances.js")) {
  (async () => {
    try {
      await connectDatabases();
      await syncLeaveBalances();
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("sync-leave-balances failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
