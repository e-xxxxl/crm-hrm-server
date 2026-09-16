import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

/**
 * READ-ONLY connections to each brand's own live production database.
 *
 * These are the real, currently-operating apps — AJ Courier Logistics,
 * QuickShipAfrica and 9jaTradiesPages each already have their own backend and
 * their own MongoDB cluster, full of real users and real transactions. This
 * module opens a connection to each (only when its URI is configured) purely
 * so services/crm/externalSync.service.js can *read* that data and mirror it
 * into the CRM's own customer/shipment/order/business records.
 *
 * Discipline: nothing in this codebase ever calls a write method (save,
 * updateOne, deleteOne, …) on a model bound to one of these connections. If a
 * source URI is not set, that brand's connection stays `null` and sync for it
 * is silently skipped — none of this is required for the platform to boot.
 *
 * No `dbName` override is applied: each source app's own `.env` connects with
 * the same bare `mongodb+srv://…/?params` string (no database segment), which
 * means the MongoDB driver defaults to their `test` database — same here, so
 * this reads from exactly the database their app actually writes to.
 */

const readOnlyOptions = {
  serverSelectionTimeoutMS: 15_000,
  socketTimeoutMS: 30_000,
  connectTimeoutMS: 15_000,
  maxPoolSize: 3,
  readPreference: "secondaryPreferred",
};

function openIfConfigured(name, uri) {
  if (!uri) return null;
  const conn = mongoose.createConnection(uri, readOnlyOptions);
  conn.on("error", (err) => logger.error(`[db:source:${name}] connection error:`, err.message));
  conn.on("connected", () => logger.info(`[db:source:${name}] connected — "${conn.name}"`));
  return conn;
}

export const ajclSourceConnection = openIfConfigured("ajcl", env.ajclSourceDbUri);
export const quickshipSourceConnection = openIfConfigured("quickship", env.quickshipSourceDbUri);
export const tradiesSourceConnection = openIfConfigured("tradies", env.tradiesSourceDbUri);

export function sourceStatus() {
  return {
    ajcl: Boolean(ajclSourceConnection),
    quickship: Boolean(quickshipSourceConnection),
    tradies: Boolean(tradiesSourceConnection),
  };
}

export default { ajclSourceConnection, quickshipSourceConnection, tradiesSourceConnection, sourceStatus };
