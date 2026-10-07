/**
 * One-time fix: compound unique indexes declared `sparse: true` (shipment /
 * order / lead / business / review externalRef; branch / department code;
 * job posting / disciplinary case reference) never skipped records with the
 * field missing, because the first key (tenantId / organizationId) is always
 * present — every such record was indexed as (org, null), so creating a second
 * one failed with "A record with that tenantid already exists". The models now
 * use partial indexes; this rebuilds the live indexes to match.
 *
 *   node scripts/fix-sparse-compound-indexes.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { Shipment } from "../models/crm/Shipment.js";
import { Order } from "../models/crm/Order.js";
import { Lead } from "../models/crm/Lead.js";
import { Business } from "../models/crm/Business.js";
import { Review } from "../models/crm/Review.js";
import { Branch } from "../models/hrm/Branch.js";
import { Department } from "../models/hrm/Department.js";
import { JobPosting } from "../models/hrm/JobPosting.js";
import { DisciplinaryCase } from "../models/hrm/DisciplinaryCase.js";

const MODELS = { Shipment, Order, Lead, Business, Review, Branch, Department, JobPosting, DisciplinaryCase };

export async function fixSparseCompoundIndexes() {
  for (const [name, model] of Object.entries(MODELS)) {
    const dropped = await model.syncIndexes();
    logger.info(`${name}: rebuilt indexes${dropped.length ? ` (replaced: ${dropped.join(", ")})` : " (already correct)"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fix-sparse-compound-indexes.js")) {
  (async () => {
    try {
      await connectDatabases();
      await fixSparseCompoundIndexes();
      logger.info("done");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("fix-sparse-compound-indexes failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
