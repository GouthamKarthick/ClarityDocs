import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import documentsRouter from "./routes/documents.route.js";
import authRouter from "./routes/auth.route.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { logger } from "./config/logger.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // request logging (info)
  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.url}`, { method: req.method, url: req.url });
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRouter);
  // documents routes require auth; keep health public
  app.use("/api", authenticate, documentsRouter);
  app.use(errorHandler);
  return app;
}
