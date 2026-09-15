import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { isSuspicious } from "../utils/security.js";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
  document_type: z
    .enum(["invoice", "receipt", "payment", "bill", "payslip", "settlement_slip", "other", "unknown"])
    .optional(),
});

export function validatePagination(req: Request, _res: Response, next: NextFunction) {
  const rawQ = (req.query.q as string) || "";
  if (rawQ && isSuspicious(rawQ)) {
    next({ status: 400, message: "Suspicious input detected in search — not saved", code: "SUSPICIOUS_INPUT" });
    return;
  }
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const err: unknown = parsed.error;
    next({ status: 400, message: "Invalid pagination", details: (err as Error).message });
    return;
  }
  // Express 5 makes req.query a getter-only; store validated values on a custom key
  (req as unknown as Record<string, unknown>)._pagination = parsed.data;
  next();
}

export const uuidSchema = z.string().uuid();
