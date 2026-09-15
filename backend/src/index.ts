import dotenv from "dotenv";
import fs from "fs";
import { createApp } from "./app.js";
import { ensureSchema } from "./db/schema.js";
import { config } from "./config.js";
import { logger } from "./config/logger.js";

dotenv.config();

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const app = createApp();

async function start() {
  // Retry ensureSchema 3x with backoff — Aiven cold start / TLS handshake can transiently fail with ER_OUT_OF_RANGE offset error if DB is MariaDB vs MySQL mismatch
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ensureSchema();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message || String(e);
      logger.error(`ensureSchema attempt ${attempt}/3 failed`, {
        error: msg,
        stack: (e as Error).stack?.slice(0, 800),
        dbHost: config.db.host,
        dbPort: config.db.port,
        dbName: config.db.database,
        dbSsl: config.db.ssl,
        hint: msg.includes("offset") || msg.includes("Protocol mismatch") || msg.includes("5010")
          ? "Check Aiven service type: this host returned MariaDB protocol 11 / mysql_old_password. Recreate as MySQL (not MariaDB) or reset password. Verify DB_HOST/DB_PORT/DB_CA_CERT in Render dashboard (no quotes)."
          : undefined,
      });
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (lastErr) {
    logger.error("DB unreachable — starting API without DB (health will show db:down). Fix Aiven service type or DB_PASSWORD/DB_CA_CERT in Render dashboard, then redeploy.", {
      error: (lastErr as Error).message,
    });
    // Start server anyway so Render health check passes and you can debug via /health
    // Retry ensureSchema in background every 30s until it succeeds
    setTimeout(function retry() {
      ensureSchema()
        .then(() => logger.info("ensureSchema retry succeeded — DB now reachable"))
        .catch((e) => {
          logger.warn("ensureSchema retry still failing", { error: (e as Error).message });
          setTimeout(retry, 30000);
        });
    }, 10000);
  }
  // 30-day hard delete: purge expired docs + files every 24h
  try {
    const { purgeExpired } = await import("./jobs/cleanup.js");
    await purgeExpired();
    setInterval(() => purgeExpired().catch((e) => logger.warn("purgeExpired failed", { error: (e as Error).message })), 24 * 60 * 60 * 1000);
    // node-cron fallback at 02:00
    import("node-cron").then((cron) => {
      cron.default.schedule("0 2 * * *", () => purgeExpired().catch((e) => logger.warn("cron purge failed", { error: (e as Error).message })));
    }).catch(() => {});
  } catch {}
  app.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port}`, {
      port: config.port,
      aiProvider: config.ai.provider,
    });
  });
}

start().catch((err) => {
  logger.error("Failed to start server", { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
