import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "../config/logger.js";

function getTransport() {
  if (!config.smtp.host) return null;
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

export async function sendVerificationEmail(to: string, token: string) {
  const transport = getTransport();
  if (!transport) {
    logger.warn("SMTP not configured, skipping verification email", { to });
    return;
  }
  const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
  const link = `${appUrl}/verify-email?token=${token}`;
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: "Verify your ClarityDocs email",
    text: `Verify: ${link}`,
    html: `<p>Click <a href="${link}">here</a> to verify your email (expires in 24h).</p>`,
  });
}

export async function sendResetEmail(to: string, token: string) {
  const transport = getTransport();
  if (!transport) {
    logger.warn("SMTP not configured, skipping reset email", { to });
    return;
  }
  const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
  const link = `${appUrl}/reset-password?token=${token}`;
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: "Reset your ClarityDocs password",
    text: `Reset: ${link} (expires 1h)`,
    html: `<p>Click <a href="${link}">here</a> to reset password (1h).</p>`,
  });
}
