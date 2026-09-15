import { Router } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { sendVerificationEmail, sendResetEmail } from "../services/email.service.js";
import { authenticate } from "../middleware/auth.js";
import { isSuspicious } from "../utils/security.js";

const router = Router();

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(6).max(128) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

function signToken(id: string, email: string) {
  return jwt.sign({ id, email }, config.jwtSecret, { expiresIn: config.jwtExpiry as unknown as jwt.SignOptions["expiresIn"] });
}

router.post("/register", async (req, res) => {
  if (isSuspicious(req.body?.email) || isSuspicious(req.body?.password)) { res.status(400).json({ error: "Suspicious input detected — not saved", code: "SUSPICIOUS_INPUT" }); return; }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid email or password (min 6 chars)" }); return; }
  const { email, password } = parsed.data;
  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  const verificationToken = randomUUID();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  try {
    await pool.query("INSERT INTO users (id, email, password_hash, verification_token, verification_expires) VALUES (?,?,?,?,?)", [id, email, hash, verificationToken, verificationExpires]);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") { res.status(409).json({ error: "Email already registered" }); return; }
    throw e;
  }
  // If SMTP not configured, auto-verify for freelancing demo
  if (!config.smtp.host) {
    await pool.query("UPDATE users SET email_verified=TRUE WHERE id=?", [id]);
  } else {
    sendVerificationEmail(email, verificationToken).catch(() => {});
  }
  const token = signToken(id, email);
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 24 * 60 * 60 * 1000 });
  res.status(201).json({ id, email, email_verified: !config.smtp.host });
});

router.post("/login", async (req, res) => {
  if (isSuspicious(req.body?.email)) { res.status(400).json({ error: "Suspicious input detected — not saved", code: "SUSPICIOUS_INPUT" }); return; }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const { email, password } = parsed.data;
  const [rows] = await pool.query("SELECT id, email, password_hash FROM users WHERE email=?", [email]);
  const user = (rows as Array<{ id: string; email: string; password_hash: string }>)[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) { res.status(401).json({ error: "Invalid credentials" }); return; }
  const token = signToken(user.id, user.email);
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 24 * 60 * 60 * 1000 });
  res.json({ id: user.id, email: user.email });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res) => {
  const user = (req as unknown as { user: { id: string; email: string } }).user;
  const [rows] = await pool.query("SELECT id, email, email_verified, created_at FROM users WHERE id=?", [user.id]);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) { res.status(404).json({ error: "User not found" }); return; }
  res.json(row);
});

router.post("/verify-email", async (req, res) => {
  const token = (req.body?.token as string) || (req.query.token as string);
  if (isSuspicious(token)) { res.status(400).json({ error: "Suspicious input detected — not saved", code: "SUSPICIOUS_INPUT" }); return; }
  if (!token) { res.status(400).json({ error: "Token required" }); return; }
  const [rows] = await pool.query("SELECT id FROM users WHERE verification_token=? AND verification_expires > NOW()", [token]);
  const user = (rows as Array<{ id: string }>)[0];
  if (!user) { res.status(400).json({ error: "Invalid or expired token" }); return; }
  await pool.query("UPDATE users SET email_verified=TRUE, verification_token=NULL, verification_expires=NULL WHERE id=?", [user.id]);
  res.json({ ok: true });
});

router.post("/forgot-password", async (req, res) => {
  const email = (req.body?.email as string)?.trim();
  if (isSuspicious(email)) { res.status(400).json({ error: "Suspicious input detected — not saved", code: "SUSPICIOUS_INPUT" }); return; }
  if (!email) { res.status(400).json({ error: "Email required" }); return; }
  const [rows] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
  const user = (rows as Array<{ id: string }>)[0];
  if (user) {
    const token = randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query("INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)", [randomUUID(), user.id, token, expires]);
    sendResetEmail(email, token).catch(() => {});
  }
  res.json({ ok: true });
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (isSuspicious(token) || isSuspicious(password)) { res.status(400).json({ error: "Suspicious input detected — not saved", code: "SUSPICIOUS_INPUT" }); return; }
  if (!token || !password || password.length < 6) { res.status(400).json({ error: "Invalid token or password" }); return; }
  const [rows] = await pool.query("SELECT user_id FROM password_reset_tokens WHERE token=? AND expires_at > NOW() AND used=FALSE", [token]);
  const row = (rows as Array<{ user_id: string }>)[0];
  if (!row) { res.status(400).json({ error: "Invalid or expired token" }); return; }
  const hash = await bcrypt.hash(password, 10);
  await pool.query("UPDATE users SET password_hash=? WHERE id=?", [hash, row.user_id]);
  await pool.query("UPDATE password_reset_tokens SET used=TRUE WHERE token=?", [token]);
  res.json({ ok: true });
});

export default router;
