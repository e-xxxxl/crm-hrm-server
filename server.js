import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import { env } from "./config/env.js";
import { connectDatabases, closeDatabases } from "./config/db.js";
import { ajclSourceConnection, quickshipSourceConnection, tradiesSourceConnection } from "./config/externalSources.js";
import { logger } from "./utils/logger.js";
import api from "./routes/index.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { startHrScheduler } from "./services/maintenance.service.js";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server (no Origin header) and any
      // configured client origin.
      if (!origin || env.clientOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(env.isProd ? "combined" : "dev"));

// The HTTP port opens first and the databases connect behind it. On a host that
// sleeps idle services (Render's free tier) the first request after a nap used
// to sit in a closed port for the whole boot — main DBs plus up to 15s per
// optional source DB — which is long enough for the browser to give up.
let dbUp = false;
let dbReady = Promise.resolve();

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "crm-hrm-api", docs: "/api/health" });
});

// Answers instantly, even mid-boot, so a wake-up ping gets a response straight
// away; `db` says whether data requests can be served yet.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", db: dbUp, time: new Date().toISOString() });
});

// Until the databases are connected, hold data requests for a short while
// instead of letting them fail: the first sign-in after a cold start then just
// takes a few seconds longer. If boot is still not done, say so clearly.
const STARTUP_WAIT_MS = 45_000;
app.use("/api", async (req, res, next) => {
  if (dbUp) return next();
  const outcome = await Promise.race([
    dbReady.then(() => "ready", () => "failed"),
    new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS, "timeout")),
  ]);
  if (outcome === "ready" || dbUp) return next();
  res.set("Retry-After", "5").status(503).json({
    error: { code: "STARTING", message: "The server is still starting up. Please try again in a few seconds." },
  });
});

app.use("/api", api);

app.use(notFound);
app.use(errorHandler);

async function start() {
  const server = app.listen(env.port, () => {
    logger.info(`API listening on :${env.port} (${env.nodeEnv})`);
    logger.info(`CORS origins: ${env.clientOrigins.join(", ")}`);
  });

  // Best-effort: a brand's source DB being unreachable must never block boot or
  // requests — sync for that brand is just unavailable until it's reachable.
  // These connections are opened at import time; this only reports on them.
  const sources = [
    ["ajcl", ajclSourceConnection],
    ["quickship", quickshipSourceConnection],
    ["tradies", tradiesSourceConnection],
  ].filter(([, conn]) => conn);
  if (sources.length) {
    logger.info(`[db:source] configured: ${sources.map(([n]) => n).join(", ")}`);
    for (const [name, conn] of sources) {
      conn.asPromise().catch((err) => logger.warn(`[db:source:${name}] not reachable: ${err.message}`));
    }
  }

  dbReady = connectDatabases();
  try {
    await dbReady;
  } catch (err) {
    logger.error("Failed to connect to the databases:", err);
    // Let the host restart us rather than serve a half-dead API — but give any
    // request already waiting a moment to receive its 503 first.
    setTimeout(() => process.exit(1), 1000);
    return;
  }
  dbUp = true;
  if (env.nodeEnv !== "test") startHrScheduler();

  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      await closeDatabases();
      await Promise.allSettled(sources.map(([, conn]) => conn.close()));
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});

export default app;
