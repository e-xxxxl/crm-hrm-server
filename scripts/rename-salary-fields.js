/**
 * One-time migration: SalaryStructure.hazard -> subsidy, .meal -> dataAllowance
 * (the schema fields were renamed). Copies existing values across for every
 * document that still has the old field names, then removes the old fields.
 *
 *   node scripts/rename-salary-fields.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { hrmConnection } from "../config/db.js";

export async function renameSalaryFields() {
  const coll = hrmConnection.collection("salarystructures");

  const result = await coll.updateMany({ $or: [{ hazard: { $exists: true } }, { meal: { $exists: true } }] }, [
    {
      $set: {
        subsidy: { $ifNull: ["$hazard", 0] },
        dataAllowance: { $ifNull: ["$meal", 0] },
      },
    },
    { $unset: ["hazard", "meal"] },
  ]);

  logger.info(`salary structures migrated: ${result.modifiedCount}`);
  return result.modifiedCount;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("rename-salary-fields.js")) {
  (async () => {
    try {
      await connectDatabases();
      await renameSalaryFields();
      logger.info("done");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("rename-salary-fields failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
