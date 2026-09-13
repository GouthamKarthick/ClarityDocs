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
  await ensureSchema();
  app.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port} (mode=${config.extractionMode})`, {
      port: config.port,
      mode: config.extractionMode,
      aiProvider: config.ai.provider,
    });
  });
}

start().catch((err) => {
  logger.error("Failed to start server", { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
