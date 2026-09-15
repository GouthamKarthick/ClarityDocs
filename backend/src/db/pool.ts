import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { config } from "../config.js";

function getSslConfig():
  | { ca: string; rejectUnauthorized: boolean }
  | { rejectUnauthorized: boolean }
  | undefined {
  if (!config.db.ssl) return undefined;
  // 1) Env var with cert content (for Render) — paste whole -----BEGIN CERTIFICATE-----
  if (config.db.sslCa) {
    return { ca: config.db.sslCa.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  }
  // 2) File at DB_CA_PATH (default backend/ca.pem) — for local
  const candidates = [config.db.sslCaPath, "./ca.pem", "backend/ca.pem", path.join(process.cwd(), "ca.pem")];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const ca = fs.readFileSync(p, "utf-8");
        if (ca.includes("BEGIN CERTIFICATE")) return { ca, rejectUnauthorized: true };
      }
    } catch {}
  }
  // Fallback — Aiven requires SSL, try without CA (may fail, but allows connection if CA not yet downloaded)
  return { rejectUnauthorized: true };
}

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  ...(getSslConfig() ? { ssl: getSslConfig() } : {}),
});
