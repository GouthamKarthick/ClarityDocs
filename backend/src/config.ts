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
  },
  extractionMode: (process.env.EXTRACTION_MODE as "inline" | "queue") || "inline",
  s3Bucket: process.env.S3_BUCKET,
  sqsQueueUrl: process.env.SQS_QUEUE_URL,
  awsRegion: process.env.AWS_REGION || "ap-south-1",
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
