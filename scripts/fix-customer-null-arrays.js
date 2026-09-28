/**
 * One-time fix for the live bug: Customer.primaryEmail/primaryPhone call
 * .find() directly on `this.emails`/`this.phones`, which crashes if that
 * field was ever explicitly persisted as null (the schema's array default
 * only fills in when the path is entirely absent, not when it's present but
 * null). The model now guards against this going forward; this corrects the
 * data that's already null in Atlas.
 *
 *   node scripts/fix-customer-null-arrays.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { Customer } from "../models/crm/Customer.js";

export async function fixCustomerNullArrays() {
  for (const field of ["emails", "phones", "addresses"]) {
    const result = await Customer.updateMany({ [field]: null }, { $set: { [field]: [] } });
    const n = result.modifiedCount ?? result.nModified ?? 0;
    logger.info(`${field}: ${n} customer(s) fixed`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fix-customer-null-arrays.js")) {
  (async () => {
    try {
      await connectDatabases();
      await fixCustomerNullArrays();
      logger.info("done");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("fix-customer-null-arrays failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
