import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { logger } from "../config/logger.js";

const execFileAsync = promisify(execFile);

export interface OcrResult {
  text: string;
  confidence: number; // 0-100 mean tesseract, or 0-1 normalized
  pages: number;
}

let tesseractWorker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;
let francFn: ((s: string) => string) | null = null;

async function getFranc() {
  if (francFn) return francFn;
  try {
    const mod = await import("franc-min");
    // franc-min exports franc function as default or named
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn: any = (mod as any).franc ?? (mod as any).default ?? mod;
    if (typeof fn === "function") francFn = fn;
  } catch (e) {
    logger.warn("franc-min load failed", { error: (e as Error).message });
  }
  return francFn;
}

function mapFrancToTesseractLang(francCode: string): string {
  // franc returns ISO 639-3 (eng, spa, fra, deu, hin ...), map to tesseract traineddata suffix
  const map: Record<string, string> = {
    eng: "eng",
    spa: "spa",
    fra: "fra",
    deu: "deu",
    ita: "ita",
    por: "por",
    nld: "nld",
    hin: "hin",
    // fallback to eng for unknown
  };
  return map[francCode] ?? "eng";
}

async function detectHintLang(textSnippet: string): Promise<string> {
  const fn = await getFranc();
  if (!fn || !textSnippet || textSnippet.trim().length < 10) return "eng";
  try {
    const code = fn(textSnippet.slice(0, 1500));
    if (code === "und") return "eng";
    return mapFrancToTesseractLang(code);
  } catch {
    return "eng";
  }
}

async function getWorker(lang: string) {
  if (tesseractWorker) {
    // tesseract.js v7 reuses worker via loadLanguage; check if lang matches
    // For simplicity, recreate if lang differs
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const curLangs: string = (tesseractWorker as any)._langs ?? "";
      if (curLangs.includes(lang)) return tesseractWorker;
      await tesseractWorker.terminate();
    } catch {
      // ignore
    }
    tesseractWorker = null;
  }
  const { createWorker } = await import("tesseract.js");
  // Primary markets US/EU/IN → eng+spa+fra+deu+ita+por+nld+hin
  // Use requested lang plus eng fallback for mixed invoices
  const langs = lang === "eng" ? "eng" : `eng+${lang}`;
  // Also preload full set lazily for better cross-language without recreation
  // Keep worker for reuse
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worker: any = await createWorker(langs, 1, {
    // logger: m => logger.debug("tesseract", m),
  });
  // Store langs used
  worker._langs = langs;
  tesseractWorker = worker;
  return worker;
}

async function preprocessWithSharp(input: Buffer): Promise<Buffer> {
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default ?? sharpMod;
    // Pipeline: resize up if small, grayscale, normalize, threshold-ish via linear
    const meta = await sharp(input).metadata();
    let s = sharp(input);
    // Upscale small receipts for better OCR
    if (meta.width && meta.width < 1200) {
      s = s.resize({ width: 1800, withoutEnlargement: false, kernel: "lanczos3" });
    }
    s = s.grayscale().normalize().sharpen({ sigma: 1.2 }).linear(1.1, -10);
    return await s.png().toBuffer();
  } catch (e) {
    logger.warn("sharp preprocess failed, using raw", { error: (e as Error).message });
    return input;
  }
}

async function ocrImageBuffer(imageBuffer: Buffer, hintLang: string): Promise<OcrResult> {
  const lang = hintLang || "eng";
  const preprocessed = await preprocessWithSharp(imageBuffer);
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(preprocessed, {}, { text: true } as never);
  // data: {text, confidence, ...} confidence 0-100
  const text = (data.text as string) || "";
  const confidence = typeof data.confidence === "number" ? data.confidence : 0;
  logger.debug("tesseract ocrImage", { lang, confidence, pages: 1, textSnippet: text.slice(0, 400) });
  return { text, confidence, pages: 1 };
}

async function rasterizePdfToPngs(pdfBuffer: Buffer): Promise<Buffer[]> {
  // Try pdftoppm (poppler) first — fastest, no JS rasterization
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clarity-raster-"));
  const tmpPdf = path.join(tmpDir, "input.pdf");
  const tmpPrefix = path.join(tmpDir, "page");
  try {
    await fs.writeFile(tmpPdf, pdfBuffer);
    try {
      await execFileAsync("pdftoppm", ["-png", "-r", "300", tmpPdf, tmpPrefix]);
      const files = await fs.readdir(tmpDir);
      const pngs = files.filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
      const buffers: Buffer[] = [];
      for (const f of pngs) {
        buffers.push(await fs.readFile(path.join(tmpDir, f)));
      }
      if (buffers.length > 0) {
        logger.debug("pdftoppm rasterized", { pages: buffers.length });
        return buffers;
      }
    } catch (e) {
      logger.warn("pdftoppm failed, falling back to pdfjs-dist", { error: (e as Error).message });
    }
    // Fallback: pdfjs-dist canvas rasterization (pure JS)
    try {
      const pngs = await rasterizeWithPdfJs(pdfBuffer);
      if (pngs.length) return pngs;
    } catch (e) {
      logger.warn("pdfjs rasterize failed", { error: (e as Error).message });
    }
    return [];
  } finally {
    // cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function rasterizeWithPdfJs(pdfBuffer: Buffer): Promise<Buffer[]> {
  // Dynamic import to avoid hard dep if not installed
  // Uses pdfjs-dist + canvas (node-canvas) if available; otherwise return []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // @ts-ignore - optional peer deps, not required for Phase 1 (pdftoppm is primary)
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-ignore - optional
    const { createCanvas } = await import("canvas");
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdf = await loadingTask.promise;
    const out: Buffer[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // ~144 dpi equivalent
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx as never, viewport }).promise;
      out.push(canvas.toBuffer("image/png"));
    }
    return out;
  } catch {
    return [];
  }
}

export async function ocrBuffer(buffer: Buffer, mime: string, hintLang?: string): Promise<OcrResult> {
  const isPdf = mime === "application/pdf" || buffer.subarray(0, 4).toString() === "%PDF";
  if (!isPdf) {
    const lang = hintLang ?? (await detectHintLang(buffer.toString("utf8").slice(0, 500))) ?? "eng";
    // For images, buffer is image bytes, not utf8 — detectHint defaults to eng
    const actualLang = hintLang ?? "eng";
    return ocrImageBuffer(buffer, actualLang);
  }

  // PDF path — rasterize each page
  const pngs = await rasterizePdfToPngs(buffer);
  if (pngs.length === 0) {
    // Last resort: try single-image tesseract on raw buffer (may work for image-wrapped PDF that is single image)
    logger.warn("rasterize returned 0 pages, trying direct tesseract on PDF buffer");
    try {
      return await ocrImageBuffer(buffer, hintLang ?? "eng");
    } catch (e) {
      logger.warn("direct pdf tesseract failed", { error: (e as Error).message });
      return { text: "", confidence: 0, pages: 0 };
    }
  }

  let combined = "";
  let totalConf = 0;
  let pagesDone = 0;
  // Limit to first 3 pages for speed in Phase1 (invoices rarely >3)
  const toOcr = pngs.slice(0, 3);
  const langHint = hintLang ?? "eng";
  for (const png of toOcr) {
    try {
      const r = await ocrImageBuffer(png, langHint);
      combined += (combined ? "\n\n" : "") + r.text;
      totalConf += r.confidence;
      pagesDone++;
    } catch (e) {
      logger.warn("page ocr failed", { error: (e as Error).message });
    }
  }
  const meanConf = pagesDone ? totalConf / pagesDone : 0;
  logger.info("pdf ocr combined", { pages: pagesDone, confidence: meanConf, textSnippet: combined.slice(0, 600) });
  return { text: combined, confidence: meanConf, pages: pagesDone };
}

// Graceful shutdown
export async function terminateOcr(): Promise<void> {
  if (tesseractWorker) {
    try {
      await tesseractWorker.terminate();
    } catch {}
    tesseractWorker = null;
  }
}
