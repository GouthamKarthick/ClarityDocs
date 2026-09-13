import express from "express";
import cors from "cors";
import documentsRouter from "./routes/documents.route.js";
import { errorHandler } from "./middleware/error.js";
import { logger } from "./config/logger.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // request logging (info)
  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.url}`, { method: req.method, url: req.url });
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", documentsRouter);
  app.use(errorHandler);
  return app;
}
