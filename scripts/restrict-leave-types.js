/**
 * One-time cleanup for the three orgs seeded before the leave-type set was
 * narrowed down to Annual / Casual / Maternity only. Deactivates every other
 * leave type (history and any already-decided requests are left untouched —
 * `active: false` just removes it from new-request pickers and admin's
 * "active" lists) and ensures all three of the kept types exist and are
 * active — including for an org that had zero LeaveType docs before this
 * ran (ensureDefaults was never triggered for it, so it needs the full set,
 * not just Casual).
 *
 *   node scripts/restrict-leave-types.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { Organization } from "../models/hrm/Organization.js";
import { LeaveType } from "../models/hrm/LeaveType.js";
import { DEFAULT_LEAVE_TYPES } from "../services/leaveType.service.js";

const KEEP_CATEGORIES = ["annual", "casual", "maternity"];

export async function restrictLeaveTypes() {
  const orgs = await Organization.find().select("_id name code");
  for (const org of orgs) {
    const { modifiedCount } = await LeaveType.updateMany(
      { organizationId: org._id, category: { $nin: KEEP_CATEGORIES }, active: true },
      { $set: { active: false } },
    );

    let ensured = 0;
    for (const def of DEFAULT_LEAVE_TYPES) {
      const existing = await LeaveType.findOne({ organizationId: org._id, category: def.category });
      if (existing) {
        if (!existing.active) {
          existing.active = true;
          await existing.save();
        }
      } else {
        await LeaveType.create({ ...def, organizationId: org._id });
        ensured += 1;
      }
    }

    logger.info(
      `${org.name} (${org.code}): deactivated ${modifiedCount} leave type(s), created ${ensured} missing default(s)`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("restrict-leave-types.js")) {
  (async () => {
    try {
      await connectDatabases();
      await restrictLeaveTypes();
      logger.info("done");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("restrict-leave-types failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
