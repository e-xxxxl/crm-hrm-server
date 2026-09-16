/**
 * Start the API against a throwaway in-memory MongoDB. For local development
 * only — no data survives a restart.
 *
 *   npm run dev:mem
 *
 * Requires the optional devDependency `mongodb-memory-server`.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  instanceOpts: [{ storageEngine: "wiredTiger", launchTimeout: 60_000 }],
});

// getUri(dbName) inserts the database name before the query string.
process.env.CRM_DB_URI = replSet.getUri("crm_db");
process.env.HRM_DB_URI = replSet.getUri("hrm_db");
process.env.NODE_ENV = process.env.NODE_ENV || "development";

// eslint-disable-next-line no-console
console.log("[dev:mem] in-memory MongoDB ready");

await import("../server.js");

// Give the server a moment to open its connections, then seed demo data.
setTimeout(async () => {
  try {
    const { seed } = await import("./seed.js");
    const { admin } = await seed({ password: "ChangeMe!2026" });
    // eslint-disable-next-line no-console
    console.log(`[dev:mem] seeded — sign in as ${admin.email} / ChangeMe!2026`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[dev:mem] seed failed:", err);
  }
}, 1500);

async function stop() {
  await replSet.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
