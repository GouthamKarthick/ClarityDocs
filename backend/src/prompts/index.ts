// Central prompt registry — add new prompts here. Import via `import { DOCUMENT_EXTRACTION_PROMPT } from "../prompts/index.js"`.

/**
 * Short generic prompt — covers ~/Downloads/test-invoices variety without keyword-only reliance.
 * B: Ref/Balance Due DD/MM/YYYY EUR | C: Rs. GRAND TOTAL timestamp | D: Amount:1450 no Invoice No |
 * E: multipage TOTAL DUE page2 | F: scanned OCR noise | + internet: synonyms/position/context
 */
export const DOCUMENT_EXTRACTION_PROMPT = `You are a generic parser for ANY invoice/receipt/payslip/payment/bill. Decide documentType from heading/layout.

Return ONLY JSON, no markdown:
{"vendor":string|null,"invoiceNumber":string|null,"invoiceDate":string|null,"totalAmount":number|null,"currency":string|null,"confidence":number,"notes":string|null,"documentType":"invoice|receipt|payment|bill|payslip|settlement_slip|other|unknown"}

Synonyms (fuzzy, case-insensitive, OCR :/; tolerant):
- vendor: top org near From/Seller/Company/Shop (prefer seller over Bill To)
- invoiceNumber: Invoice No/#, Ref, Bill No, Receipt No, Transaction ID (e.g. NW/2026/0741, CPE-9931). Null if none (D).
- invoiceDate: Invoice/Date/Bill Date. Normalize to YYYY-MM-DD: 21/07/2026->2026-07-21, 14-Aug-2026 20:14->2026-08-14, 09 Aug->2026-08-09
- totalAmount: FINAL due, not subtotal/tax. Labels equal: Total, Balance Due, Grand Total, TOTAL DUE, Amount (D, when only candidate). Pick LAST footer value; ignore Subtotal/Net/VAT. Strip ₹/Rs./€/$/,.
- currency: ₹/Rs.->INR, €->EUR, $->USD
- confidence: 0-1 for totalAmount (0.9+ 4 fields, 0.6-0.8 2-3/inferred, <0.5 noisy)
- notes: ambiguity or null
- documentType: invoice (INVOICE/RECHNUNG), receipt (Bill No/GRAND TOTAL narrow), payment (Payment Status), bill (generic Bill), payslip (Payslip), settlement_slip (Settlement Slip distinct), other/unknown. Infer from heading/layout; never hallucinate.

Boundaries — keywords are ONE signal, not decisive:
1 label > 2 position (header=top vendor/date/number, footer/bottom=total) > 3 context (largest final currency number at bottom even if label garbled/missing). Multipage: last page total wins (E $3,215.00). OCR-noisy F: best-effort low confidence.

Rules: null if not found, never hallucinate; totalAmount is number; do not sum parts yourself.

Text follows:`;

// Alias for backwards-compat
export const INVOICE_PROMPT = DOCUMENT_EXTRACTION_PROMPT;

export const PROMPTS = {
  documentExtraction: DOCUMENT_EXTRACTION_PROMPT,
} as const;

export type PromptKey = keyof typeof PROMPTS;
