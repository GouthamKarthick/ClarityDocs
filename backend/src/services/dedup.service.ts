import { pool } from "../db/pool.js";
import type { ExtractedInvoiceData } from "../types/index.js";

// Normalize for content dedup: 4 fields must be similar (all non-null)
function normVendor(v?: string): string | null {
  if (!v) return null;
  return v.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}
function normInvoiceNo(v?: string): string | null {
  if (!v) return null;
  return v.trim().toUpperCase();
}
function normCurrency(v?: string): string | null {
  if (!v) return null;
  return v.trim().toUpperCase();
}
function normTotal(v?: number): number | null {
  if (v == null || isNaN(v)) return null;
  return Number(Number(v).toFixed(2));
}

function isDuplicateContent(a: ExtractedInvoiceData, b: ExtractedInvoiceData): boolean {
  const av = normVendor(a.vendor);
  const bv = normVendor(b.vendor);
  const ai = normInvoiceNo(a.invoiceNumber);
  const bi = normInvoiceNo(b.invoiceNumber);
  const at = normTotal(a.totalAmount);
  const bt = normTotal(b.totalAmount);
  const ac = normCurrency(a.currency);
  const bc = normCurrency(b.currency);
  // All 4 must be non-null to compare; any null => cannot be duplicate per requirement
  if (!av || !bv || !ai || !bi || at == null || bt == null || !ac || !bc) return false;
  return av === bv && ai === bi && at === bt && ac === bc;
}

export async function findDuplicateByContent(
  newData: ExtractedInvoiceData,
  userId?: string
): Promise<{ duplicate: boolean; duplicateOf?: string; matchedData?: ExtractedInvoiceData }> {
  const av = normVendor(newData.vendor);
  const ai = normInvoiceNo(newData.invoiceNumber);
  const at = normTotal(newData.totalAmount);
  const ac = normCurrency(newData.currency);
  if (!av || !ai || at == null || !ac) return { duplicate: false };
  const where = userId ? "WHERE status='done' AND data IS NOT NULL AND user_id=? AND expires_at > NOW() LIMIT 200" : "WHERE status='done' AND data IS NOT NULL AND expires_at > NOW() LIMIT 200";
  const params = userId ? [userId] : [];
  const [rows] = await pool.query(`SELECT id, data FROM documents ${where}`, params);
  for (const r of rows as Array<{ id: string; data: string }>) {
    try {
      const d = typeof r.data === "string" ? (JSON.parse(r.data) as ExtractedInvoiceData) : (r.data as unknown as ExtractedInvoiceData);
      if (isDuplicateContent(newData, d)) {
        return { duplicate: true, duplicateOf: r.id, matchedData: d };
      }
    } catch {
      continue;
    }
  }
  return { duplicate: false };
}
