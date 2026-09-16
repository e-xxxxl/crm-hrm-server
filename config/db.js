import mongoose from "mongoose";
import { env } from "./env.js";

/**
 * Dual-database connection layer.
 *
 * The platform keeps HRM and CRM data in two separate logical databases
 * (`hrm_db` and `crm_db`). Mongoose models are bound to a specific connection
 * so a query on an HRM model can never touch a CRM collection and vice versa.
 *
 * Import { hrmConnection, crmConnection } in model files and call
 * `connectDatabases()` once at server boot.
 */

mongoose.set("strictQuery", true);

const commonOptions = {
  serverSelectionTimeoutMS: 20_000,
  socketTimeoutMS: 45_000,
  connectTimeoutMS: 20_000,
  maxPoolSize: 10,
  retryWrites: true,
};

export const hrmConnection = mongoose.createConnection(env.hrmDbUri, commonOptions);
export const crmConnection = mongoose.createConnection(env.crmDbUri, commonOptions);

hrmConnection.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db:hrm] connection error:", err.message);
});
crmConnection.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db:crm] connection error:", err.message);
});

/**
 * Wait for both connections to be usable. Rejects with a helpful message if a
 * cluster is unreachable (common Atlas misconfigurations are listed).
 */
export async function connectDatabases() {
  try {
    await Promise.all([hrmConnection.asPromise(), crmConnection.asPromise()]);
    // eslint-disable-next-line no-console
    console.log(
      `[db] connected — hrm:"${hrmConnection.name}" crm:"${crmConnection.name}"`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[db] could not connect to MongoDB.\n" +
        "  If using Atlas: (1) use the SRV connection string, (2) allow 0.0.0.0/0\n" +
        "  under Network Access, (3) verify user / password / database name.\n" +
        `  Original error: ${err.message}`,
    );
    throw err;
  }
}

/** Close both pools — used by the graceful shutdown handler. */
export async function closeDatabases() {
  await Promise.allSettled([hrmConnection.close(), crmConnection.close()]);
}

export default { hrmConnection, crmConnection, connectDatabases, closeDatabases };
