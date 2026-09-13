import { config } from "../config.js";
import { logger } from "../config/logger.js";
import type { ExtractionResult, ExtractedInvoiceData } from "../types/index.js";
import { DOCUMENT_EXTRACTION_PROMPT } from "../prompts/index.js";

function stripJsonFence(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  return t;
}

const ALLOWED_DOCTYPES = new Set([
  "invoice",
  "receipt",
  "payment",
  "bill",
  "payslip",
  "settlement_slip",
  "other",
  "unknown",
]);

function normalizeDocumentType(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  const t = v.trim().toLowerCase().replace(/[\s\-]+/g, "_");
  if (ALLOWED_DOCTYPES.has(t)) return t;
  if (t.includes("settlement")) return "settlement_slip";
  if (t.includes("pay") && t.includes("slip")) return "payslip";
  if (t === "inv" || t.includes("invoice")) return "invoice";
  if (t.includes("receipt")) return "receipt";
  if (t.includes("payment")) return "payment";
  if (t === "bill") return "bill";
  return "other";
}

function validateAndNormalize(raw: unknown): {
  data: ExtractedInvoiceData;
  confidence: number;
  documentType: string;
} {
  const r = raw as Record<string, unknown>;
  const data: ExtractedInvoiceData = {};
  if (typeof r.vendor === "string" && r.vendor.trim()) data.vendor = r.vendor.trim().slice(0, 120);
  if (typeof r.invoiceNumber === "string" && r.invoiceNumber.trim()) data.invoiceNumber = r.invoiceNumber.trim();
  if (typeof r.invoiceDate === "string" && r.invoiceDate.trim()) data.invoiceDate = normalizeDate(r.invoiceDate.trim());
  if (typeof r.totalAmount === "number" && !isNaN(r.totalAmount)) data.totalAmount = r.totalAmount;
  else if (typeof r.totalAmount === "string") {
    const n = Number(r.totalAmount.replace(/[,₹$€\s]|Rs\.?/gi, ""));
    if (!isNaN(n)) data.totalAmount = n;
  }
  if (typeof r.currency === "string" && r.currency.trim()) {
    const c = r.currency.trim().toUpperCase();
    if (["INR", "USD", "EUR"].includes(c)) data.currency = c;
    else if (c.includes("₹") || c.includes("RS") || c === "INR") data.currency = "INR";
    else if (c.includes("$") || c === "USD") data.currency = "USD";
    else if (c.includes("€") || c === "EUR") data.currency = "EUR";
  } else if (typeof r.totalAmount === "string" && /Rs\.?/i.test(r.totalAmount)) {
    data.currency = "INR";
  }
  let confidence = 0;
  if (typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1) confidence = r.confidence;
  else {
    const filled = Object.keys(data).length;
    confidence = Math.min(1, filled / 4);
  }
  const documentType = normalizeDocumentType((r as Record<string, unknown>).documentType ?? (r as Record<string, unknown>).document_type);
  return { data, confidence, documentType };
}

function normalizeDate(s: string): string {
  // already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY -> YYYY-MM-DD
  const m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // e.g. 11 Sep 2026 or Sep 11, 2026 -> try Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

async function callGemini(text: string, imageBase64?: string, mimeType?: string): Promise<unknown> {
  const key = config.ai.apiKey;
  if (!key) throw new Error("AI_API_KEY not set in backend/.env");
  const model = config.ai.model || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const parts: Array<Record<string, unknown>> = [{ text: DOCUMENT_EXTRACTION_PROMPT }, { text: text.slice(0, 12000) }];
  if (imageBase64) {
    parts.splice(1, 0, { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const outText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!outText) throw new Error("Gemini empty response");
  return JSON.parse(stripJsonFence(outText));
}

async function callAnthropic(text: string, imageBase64?: string, mimeType?: string): Promise<unknown> {
  const key = config.ai.apiKey;
  if (!key) throw new Error("AI_API_KEY not set");
  const model = config.ai.model.includes("claude") ? config.ai.model : "claude-3-haiku-20240307";
  const url = "https://api.anthropic.com/v1/messages";

  const content: Array<Record<string, unknown>> = [{ type: "text", text: text.slice(0, 12000) }];
  if (imageBase64) {
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 },
    });
  }

  const body = {
    model,
    max_tokens: 512,
    system: DOCUMENT_EXTRACTION_PROMPT,
    messages: [{ role: "user", content }],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = (await res.json()) as { content?: Array<{ text?: string }> };
  const outText = json.content?.[0]?.text;
  if (!outText) throw new Error("Anthropic empty response");
  return JSON.parse(stripJsonFence(outText));
}

export async function extractWithAI(
  text: string,
  opts?: { imageBase64?: string; mimeType?: string }
): Promise<ExtractionResult & { latency: number; cost: number }> {
  const start = Date.now();
  let raw: unknown;
  const provider = config.ai.provider;
  logger.debug("AI request", { provider, model: config.ai.model, textSnippet: text.slice(0, 400) });

  if (provider === "anthropic") {
    raw = await callAnthropic(text, opts?.imageBase64, opts?.mimeType);
  } else {
    raw = await callGemini(text, opts?.imageBase64, opts?.mimeType);
  }

  const { data, confidence, documentType } = validateAndNormalize(raw);
  const latency = Date.now() - start;
  const cost = 0;
  logger.info("AI response", { provider, method: "llm", confidence, latency, data, documentType });

  return { data, confidence, method: "llm", latency, cost, documentType: documentType as ExtractionResult["documentType"], documentTypeConfidence: confidence };
}

 // generic wrapper used by extraction.service orchestrator
export async function tryAI(
  text: string,
  imageBase64?: string,
  mimeType?: string
): Promise<ExtractionResult> {
  try {
    const r = await extractWithAI(text, imageBase64 ? { imageBase64, mimeType: mimeType || "image/jpeg" } : undefined);
    return {
      data: r.data,
      confidence: r.confidence,
      method: r.method,
      documentType: r.documentType as ExtractionResult["documentType"],
      documentTypeConfidence: r.confidence,
    };
  } catch (e) {
    throw e;
  }
}
