import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "../config.js";
import { logger } from "../config/logger.js";
import type { ExtractionResult } from "../types/index.js";
import { tryAI } from "./ai.service.js";
import { ocrBuffer } from "./ocr.service.js";

const execFileAsync = promisify(execFile);

function getImageMime(buffer: Buffer): string {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  // fallback — multer allowed only png/jpeg, default to jpeg for AI vision
  return "image/jpeg";
}

// pdf-parse is CJS; dynamic import for ESM compat
async function parsePdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let text = "";
  try {
    const mod: any = await import("pdf-parse");
    const fn: any = mod.default ?? mod;
    if (typeof fn === "function") {
      const data = await fn(buffer);
      text = (data.text as string) || "";
      if (text.trim().length > 10) return text;
    }
  } catch (e) {
    logger.warn("pdf-parse failed, trying pdftotext", { error: (e as Error).message });
  }
  // Fallback: pdftotext (poppler) — handles bad XRef PDFs that pdf-parse chokes on
  try {
    // Write buffer to temp file via stdin: use pdftotext with - (stdout)
    // Use execFile with input via temp file to avoid shell
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = `/tmp/clarity-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    await writeFile(tmp, buffer);
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", tmp, "-"]);
      text = stdout || "";
    } finally {
      await unlink(tmp).catch(() => {});
    }
    if (text.trim().length > 5) return text;
  } catch (e) {
    logger.warn("pdftotext fallback failed", { error: (e as Error).message });
  }
  return text;
}

function extractWithRegex(text: string): { data: ExtractionResult["data"]; confidence: number } {
  const normalized = text.replace(/\r/g, " ");
  const data: ExtractionResult["data"] = {};

  // vendor: first non-empty line or "Vendor:" pattern
  const vendorMatch = normalized.match(/(?:vendor|from|seller)\s*[:\-]\s*([^\n]+)/i);
  if (vendorMatch?.[1]) data.vendor = vendorMatch[1].trim().slice(0, 120);
  else {
    const firstLine = normalized.split("\n").map((s) => s.trim()).find(Boolean);
    if (firstLine && firstLine.length < 80) data.vendor = firstLine;
  }

  // invoice number
  const invMatch = normalized.match(/(?:invoice\s*(?:no|number|#))\s*[:\-#]?\s*([A-Z0-9\-\/]+)/i);
  if (invMatch?.[1]) data.invoiceNumber = invMatch[1].trim();

  // date YYYY-MM-DD or DD/MM/YYYY or MM/DD/YYYY
  const dateMatch =
    normalized.match(/(\d{4}-\d{2}-\d{2})/) || normalized.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
  if (dateMatch?.[1]) data.invoiceDate = dateMatch[1];

  // total amount: support Balance Due / Grand Total / Amount without keyword-only reliance
  // covers: Total Amount Due, Balance Due, Grand Total, TOTAL DUE, Amount (D informal), Rs. prefix
  const totalPattern = /(?:total amount due|balance due|grand\s*total|total due|total|amount)[\s\S]{0,60}?(?:₹|Rs\.?|\$|€)?\s*([0-9,]+\.\d{2})/i;
  const totalMatches = [...normalized.matchAll(new RegExp(totalPattern, "gi"))];
  const totalMatch = totalMatches.length ? totalMatches[totalMatches.length - 1] : null;
  const fallbackMatch = !totalMatch ? normalized.match(/(?:₹|Rs\.?|\$|€)\s*[0-9,]+\.\d{2}/i) : null;
  let amountRaw: string | undefined = totalMatch?.[1] ?? (fallbackMatch?.[0] ?? undefined);
  if (amountRaw) {
    // fallbackMatch includes symbol, extract number
    const numStr = amountRaw.match(/([0-9,]+\.\d{2})/)?.[1] ?? amountRaw;
    const raw = numStr.replace(/[₹$€,\s]/g, "").replace(/Rs\.?/gi, "");
    const num = Number(raw);
    if (!isNaN(num)) data.totalAmount = num;
  } else {
    // D informal: Amount: 1450 without decimals
    const informal = normalized.match(/(?:amount)\s*[:\-]?\s*(?:₹|Rs\.?)?\s*([0-9,]+)(?!\.\d)/i);
    if (informal?.[1]) {
      const n = Number(informal[1].replace(/,/g, "").replace(/Rs\.?/gi, ""));
      if (!isNaN(n)) data.totalAmount = n;
    }
  }

  // currency hint (Rs. treated as INR)
  if (/₹/.test(normalized) || /Rs\.?/.test(normalized)) data.currency = "INR";
  else if (/\$/.test(normalized)) data.currency = "USD";
  else if (/€/.test(normalized)) data.currency = "EUR";

  const filled = Object.keys(data).length;
  // confidence = fields filled / 4 (vendor, invoiceNumber, date, total)
  const confidence = Math.min(1, filled / 4);

  return { data, confidence };
}

// Tiered doc type detection: heading/layout first, AI fallback
function detectDocType(text: string): { type: string; confidence: number } {
  const t = text.toLowerCase();
  const heading = text.split("\n").slice(0, 8).join("\n").toLowerCase();
  const isNarrowReceipt = /grand\s*total/i.test(text) && /rs\.?/i.test(text) && text.split("\n").length < 20;
  const hasMultipage = /page\s*1\s*of\s*2/i.test(text) || /page\s*2\s*of\s*2/i.test(text);
  // heading/layout scores
  if (heading.includes("settlement slip")) return { type: "settlement_slip", confidence: 0.95 };
  if (t.includes("settlement slip")) return { type: "settlement_slip", confidence: 0.9 };
  if (heading.includes("payslip") || t.includes("payslip")) return { type: "payslip", confidence: 0.9 };
  if (heading.includes("payment status") || heading.includes("payment received") || t.includes("payment status")) return { type: "payment", confidence: 0.9 };
  if (isNarrowReceipt || heading.includes("chai point") || /bill\s*no\s*:/i.test(heading)) return { type: "receipt", confidence: 0.85 };
  if (t.includes("receipt")) return { type: "receipt", confidence: 0.7 };
  if (heading.includes("invoice") || heading.includes("rechnung") || /invoice\s*(number|#|no)/i.test(heading)) return { type: "invoice", confidence: 0.85 };
  if (hasMultipage && /total\s*due/i.test(text)) return { type: "invoice", confidence: 0.8 };
  if (t.includes("invoice") || t.includes("rechn")) return { type: "invoice", confidence: 0.6 };
  if (/^\s*bill\s*$/im.test(heading)) return { type: "bill", confidence: 0.6 };
  // informal other: has Amount but no heading type
  if (/amount\s*:\s*[0-9]/i.test(text) && !/invoice|receipt|payment|payslip|settlement/i.test(t)) return { type: "other", confidence: 0.5 };
  if (text.trim().length < 15) return { type: "unknown", confidence: 0.3 };
  return { type: "other", confidence: 0.4 };
}

export async function extract(filePathOrBuffer: string | Buffer): Promise<ExtractionResult> {
  const start = Date.now();
  let text = "";
  let buffer: Buffer | null = null;
  let ocrConfidence = 0;
  let ocrPages = 0;

  try {
    buffer =
      typeof filePathOrBuffer === "string"
        ? await fs.readFile(filePathOrBuffer)
        : filePathOrBuffer;

    const isPdf = buffer.subarray(0, 4).toString() === "%PDF";
    if (isPdf) {
      text = await parsePdf(buffer);
      // Image-wrapped PDF detection: text layer <20 chars → try lib OCR first
      if (text.trim().length < 20) {
        logger.info("Scanned PDF detected, invoking lib OCR", { textLen: text.trim().length });
        try {
          const r = await ocrBuffer(buffer, "application/pdf");
          if (r.text.trim().length > text.trim().length) {
            text = r.text;
            ocrConfidence = r.confidence;
            ocrPages = r.pages;
            logger.info("Lib OCR succeeded for PDF", { confidence: ocrConfidence, pages: ocrPages, textSnippet: text.slice(0, 600) });
          }
        } catch (e) {
          logger.warn("Lib OCR failed for PDF, will fallback to AI", { error: (e as Error).message });
        }
      }
    } else {
      // Image (png/jpeg) — lib OCR first, not utf8 dump
      const mime = getImageMime(buffer);
      logger.info("Image detected, invoking lib OCR", { mime, size: buffer.length });
      try {
        const r = await ocrBuffer(buffer, mime);
        text = r.text;
        ocrConfidence = r.confidence;
        ocrPages = r.pages;
        logger.info("Lib OCR succeeded for image", { mime, confidence: ocrConfidence, textSnippet: text.slice(0, 600) });
      } catch (e) {
        logger.warn("Lib OCR failed for image", { error: (e as Error).message, mime });
        // fallback to utf8 only as last resort (should rarely happen)
        text = buffer.toString("utf8");
        if (text.trim().length < 5) text = "";
      }
    }
  } catch (e) {
    logger.warn("PDF parse failed", { error: (e as Error).message, stack: (e as Error).stack });
  }

  // 1) regex first (cheap) + tiered docType (lib OCR already attempted)
  const regex = extractWithRegex(text);
  const docTypeRes = detectDocType(text);
  logger.debug("Regex extraction", {
    docType: docTypeRes.type,
    docTypeConfidence: docTypeRes.confidence,
    confidence: regex.confidence,
    data: regex.data,
    ocrConfidence,
    ocrPages,
    textSnippet: text.slice(0, 800),
  });

  // Gate: if both data and type are confident, skip AI (lib-first already done)
  const typeConfident = docTypeRes.confidence >= 0.6;
  if (regex.confidence >= config.ai.threshold && typeConfident) {
    return {
      data: regex.data,
      confidence: regex.confidence,
      method: ocrConfidence > 0 ? "tesseract+regex" : "regex",
      documentType: docTypeRes.type as ExtractionResult["documentType"],
      documentTypeConfidence: docTypeRes.confidence,
    };
  }

  // 2) LLM fallback — deduce type + fill missing fields
  const hasText = text.trim().length > 20;
  const isImage = buffer ? buffer.subarray(0, 4).toString() !== "%PDF" : false;
  const isScannedPdf = !hasText && buffer ? buffer.subarray(0, 4).toString() === "%PDF" : false;
  const needAIForType = !typeConfident;
  if (config.ai.apiKey && (hasText || isImage || isScannedPdf || needAIForType)) {
    try {
      const imageBase64 = isImage ? buffer!.toString("base64") : isScannedPdf ? buffer!.toString("base64") : undefined;
      const imageMime = isScannedPdf ? "application/pdf" : "image/jpeg";
      const aiText = hasText ? text : `Scanned ${docTypeRes.type} with no text layer — extract from image.`;
      const ai = await tryAI(aiText, imageBase64 ? imageBase64 : undefined, imageMime);
      logger.info("AI extraction", { method: ai.method, confidence: ai.confidence, data: ai.data, documentType: ai.documentType });
      // Determine final documentType: AI wins if type was uncertain
      const finalDocType = needAIForType && ai.documentType ? ai.documentType : docTypeRes.type;
      const finalTypeConf = needAIForType ? ai.documentTypeConfidence : docTypeRes.confidence;
      const aiHasData = Object.keys(ai.data).length > 0;
      if (!aiHasData && !needAIForType) {
        return {
          data: regex.data,
          confidence: regex.confidence,
          method: ocrConfidence > 0 ? "tesseract+regex" : "regex",
          documentType: finalDocType as ExtractionResult["documentType"],
          documentTypeConfidence: finalTypeConf,
        };
      }
      if (aiHasData && ai.confidence >= regex.confidence) {
        return {
          data: ai.data,
          confidence: ai.confidence,
          method: ai.method,
          documentType: finalDocType as ExtractionResult["documentType"],
          documentTypeConfidence: finalTypeConf,
        };
      }
      if (aiHasData) {
        const merged: ExtractionResult["data"] = { ...regex.data };
        for (const [k, v] of Object.entries(ai.data)) if ((merged as Record<string, unknown>)[k] == null && v != null) (merged as Record<string, unknown>)[k] = v;
        return {
          data: merged,
          confidence: Math.max(regex.confidence, ai.confidence),
          method: `regex+${ai.method}`,
          documentType: finalDocType as ExtractionResult["documentType"],
          documentTypeConfidence: finalTypeConf,
        };
      }
      // AI had no data but corrected type
      return {
        data: regex.data,
        confidence: regex.confidence,
        method: needAIForType ? ai.method : "regex",
        documentType: finalDocType as ExtractionResult["documentType"],
        documentTypeConfidence: finalTypeConf,
      };
    } catch (e) {
      // AI failed (no key, rate limit) -> fall back to regex
      logger.warn("AI extraction failed, falling back to regex", { error: (e as Error).message });
    }
  }

  const latency = Date.now() - start;
  logger.info("Extraction latency", { latency, method: "regex", ocrConfidence, hasText: text.trim().length });
  return {
    data: regex.data,
    confidence: regex.confidence,
    method: ocrConfidence > 0 ? `tesseract+regex` : "regex",
    documentType: docTypeRes.type as ExtractionResult["documentType"],
    documentTypeConfidence: docTypeRes.confidence,
  };
}
