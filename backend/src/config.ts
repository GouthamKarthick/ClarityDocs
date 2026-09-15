import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  maxFileSize: Number(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "clarity_user",
    password: process.env.DB_PASSWORD || "clarity_pass",
    database: process.env.DB_NAME || "clarity_docs",
    ssl: process.env.DB_SSL === "true" || (process.env.DB_HOST || "").includes("aivencloud.com"),
    sslCaPath: process.env.DB_CA_PATH || "./ca.pem",
    sslCa: process.env.DB_CA_CERT || "",
  },
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiry: process.env.JWT_EXPIRY || "1d",
  retentionDays: Number(process.env.RETENTION_DAYS) || 30,
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "noreply@claritydocs.local",
  },
  ai: {
    provider: (process.env.AI_PROVIDER as "google" | "anthropic" | "openai") || "google",
    model: process.env.AI_MODEL || "gemini-flash-latest",
    apiKey: process.env.AI_API_KEY || "",
    threshold: Number(process.env.AI_CONFIDENCE_THRESHOLD) || 0.5,
  },
  logs: {
    dir: "./logs",
    level: process.env.LOG_LEVEL || "debug",
  },
} as const;
