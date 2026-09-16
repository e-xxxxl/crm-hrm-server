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

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "crm-hrm-api", docs: "/api/health" });
});

app.use("/api", api);

app.use(notFound);
app.use(errorHandler);

async function start() {
  await connectDatabases();

  // Best-effort: a brand's source DB being unreachable must never block boot —
  // sync for that brand is just unavailable until it's configured / reachable.
  const sources = [
    ["ajcl", ajclSourceConnection],
    ["quickship", quickshipSourceConnection],
    ["tradies", tradiesSourceConnection],
  ].filter(([, conn]) => conn);
  await Promise.allSettled(
    sources.map(([name, conn]) =>
      conn.asPromise().catch((err) => logger.warn(`[db:source:${name}] not reachable at boot: ${err.message}`)),
    ),
  );
  if (sources.length) {
    logger.info(`[db:source] configured: ${sources.map(([n]) => n).join(", ")}`);
  }

  if (env.nodeEnv !== "test") startHrScheduler();
  const server = app.listen(env.port, () => {
    logger.info(`API listening on :${env.port} (${env.nodeEnv})`);
    logger.info(`CORS origins: ${env.clientOrigins.join(", ")}`);
  });

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
