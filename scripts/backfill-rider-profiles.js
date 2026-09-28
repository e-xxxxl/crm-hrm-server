/**
 * One-time fix: any employee who was given the "Rider" role through the HRM
 * Employees screen (Create login / Manage login), rather than through CRM ->
 * Riders -> provision login, got a User membership but no matching Rider
 * document. Their PWA login then hit selfRider()'s "your login is not
 * linked to a rider profile" error. Walks every "Rider" membership and links
 * or creates the missing Rider doc, same logic as
 * employee.service.js#ensureRiderProfile going forward.
 *
 *   node scripts/backfill-rider-profiles.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { User } from "../models/hrm/User.js";
import { Employee } from "../models/hrm/Employee.js";
import { Rider } from "../models/crm/Rider.js";
import { nextCode } from "../models/crm/Counter.js";

export async function backfillRiderProfiles() {
  const users = await User.find({ "memberships.role": "Rider" });
  let linked = 0;
  let created = 0;
  let skipped = 0;

  for (const user of users) {
    for (const m of user.memberships) {
      if (m.role !== "Rider" || m.status !== "active") continue;
      const orgId = m.organization;

      const already = await Rider.findOne({ tenantId: orgId, user: user._id });
      if (already) {
        skipped += 1;
        continue;
      }

      const employee =
        (m.employee && (await Employee.findById(m.employee))) ||
        (await Employee.findOne({ organizationId: orgId, user: user._id }));

      const phone = employee?.phone || user.phone;
      const unlinked = phone ? await Rider.findOne({ tenantId: orgId, phone, user: null }) : null;

      if (unlinked) {
        unlinked.user = user._id;
        if (employee) unlinked.employee = employee._id;
        await unlinked.save();
        linked += 1;
        logger.info(`Linked existing rider ${unlinked.riderCode} (${unlinked.name}) to ${user.email}`);
        continue;
      }

      if (!phone) {
        logger.warn(`Skipping ${user.email} in org ${orgId} — no phone number to create a Rider with`);
        continue;
      }

      const riderCode = await nextCode("RID", `${orgId}:rider`, 4);
      const rider = await Rider.create({
        tenantId: orgId,
        riderCode,
        name: employee?.fullName || user.name,
        phone,
        email: user.email,
        user: user._id,
        employee: employee?._id,
        vehicleType: "bike",
        status: "active",
      });
      created += 1;
      logger.info(`Created rider ${rider.riderCode} (${rider.name}) for ${user.email}`);
    }
  }

  logger.info(`Done — ${linked} linked, ${created} created, ${skipped} already OK`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("backfill-rider-profiles.js")) {
  (async () => {
    try {
      await connectDatabases();
      await backfillRiderProfiles();
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("backfill-rider-profiles failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
