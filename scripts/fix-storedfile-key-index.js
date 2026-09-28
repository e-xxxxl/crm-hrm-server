/**
 * One-time fix: StoredFile.key is declared `unique: true, sparse: true` in
 * the schema, but the live index in Atlas predates that (or was never
 * synced) and is a plain unique index. A plain unique index still indexes
 * *missing* fields as null, so the first Cloudinary upload (which never sets
 * `key` — that field is legacy, local-disk-only) succeeds, and every
 * subsequent one collides with that same null entry: "E11000 duplicate key
 * error ... key: null". syncIndexes() drops the stale index and rebuilds it
 * to match the schema (sparse), so missing `key` values stop colliding.
 *
 *   node scripts/fix-storedfile-key-index.js
 */
import { connectDatabases, closeDatabases } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { StoredFile } from "../models/hrm/StoredFile.js";

export async function fixStoredFileKeyIndex() {
  const before = await StoredFile.collection.indexes();
  logger.info(`StoredFile indexes before: ${JSON.stringify(before)}`);

  const result = await StoredFile.syncIndexes();
  logger.info(`syncIndexes result: ${JSON.stringify(result)}`);

  const after = await StoredFile.collection.indexes();
  logger.info(`StoredFile indexes after: ${JSON.stringify(after)}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("fix-storedfile-key-index.js")) {
  (async () => {
    try {
      await connectDatabases();
      await fixStoredFileKeyIndex();
      logger.info("done");
      await closeDatabases();
      process.exit(0);
    } catch (err) {
      logger.error("fix-storedfile-key-index failed:", err);
      await closeDatabases();
      process.exit(1);
    }
  })();
}
