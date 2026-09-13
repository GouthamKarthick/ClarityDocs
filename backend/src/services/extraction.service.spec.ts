import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    default: { ...(orig.default as Record<string, unknown>), readFile: vi.fn() },
    readFile: vi.fn(),
  };
});

// Mock ocr.service — lib-first OCR
vi.mock("./ocr.service.js", () => ({
  ocrBuffer: vi.fn(),
}));

// Mock ai.service — LLM fallback
vi.mock("./ai.service.js", () => ({
  tryAI: vi.fn(),
}));

vi.mock("../config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import fs from "fs/promises";
import { ocrBuffer } from "./ocr.service.js";
import { tryAI } from "./ai.service.js";
import { extract } from "./extraction.service.js";
import { config } from "../config.js";

const mockReadFile = vi.mocked(fs.readFile);
const mockOcr = vi.mocked(ocrBuffer);
const mockTryAI = vi.mocked(tryAI);

// Minimal valid PNG bytes (PNG magic) + JPEG magic helpers
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

function ocrText(t: string, confidence = 95, pages = 1) {
  return { text: t, confidence, pages };
}

describe("extraction.service — extract() via mocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (config as any).ai = { ...config.ai, apiKey: "", threshold: 0.5 };
  });

  it("invoice image: regex parses vendor, invoiceNumber, total Rs., confidence 0.75+ skips AI", async () => {
    mockOcr.mockResolvedValue(
      ocrText("Acme Corp\nInvoice Number: INV-123\nInvoice Date: 2024-02-01\nTotal Amount Due: Rs. 1,300.00")
    );

    const r = await extract(pngBuffer);

    expect(r.data.vendor).toBeDefined();
    expect(r.data.invoiceNumber).toBe("INV-123");
    expect(r.data.totalAmount).toBe(1300);
    expect(r.data.currency).toBe("INR");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.documentType).toBe("invoice");
    expect(r.method).toMatch(/regex/);
    expect(mockTryAI).not.toHaveBeenCalled();
  });

  it("empty / short text → unknown type low confidence, returns regex path", async () => {
    (config as any).ai.apiKey = ""; // ensure no AI
    mockOcr.mockResolvedValue(ocrText("hi")); // <15 chars → unknown
    mockTryAI.mockResolvedValue({ data: {}, confidence: 0, method: "llm", documentType: "unknown", documentTypeConfidence: 0 } as any);
    const r = await extract(pngBuffer);
    expect(r.documentType).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.method).toMatch(/regex/);
  });

  it("receipt narrow: grand total + Rs. + <20 lines → receipt", async () => {
    const receipt = "Chai Point\nBill No: CP-99\nGrand Total\nRs. 200.00\nThank you";
    mockOcr.mockResolvedValue(ocrText(receipt));
    const r = await extract(pngBuffer);
    expect(r.documentType).toBe("receipt");
  });

  it("scanned PDF: text layer <20 chars triggers ocrBuffer with application/pdf + type detection", async () => {
    // PDF magic %PDF, but content <20 chars → scanned path
    const pdfBuffer = Buffer.from("%PDF-1.4\n% empty - no text layer");
    // pdf-parse will be tried, but our mock ocrBuffer must fire
    mockOcr.mockResolvedValue(ocrText("Invoice Number: SCAN-1\nTotal: $99.99"));
    const r = await extract(pdfBuffer);
    // ocrBuffer should have been called at least once
    expect(mockOcr).toHaveBeenCalled();
    const firstCallArgs = mockOcr.mock.calls[0];
    expect(firstCallArgs[1]).toBe("application/pdf");
    expect(r.data.invoiceNumber).toBe("SCAN-1");
  });

  it("gate high confidence skips AI even when AI key present", async () => {
    (config as any).ai.apiKey = "fake-key";
    mockOcr.mockResolvedValue(
      ocrText("Invoice Number: INV-999\n2024-02-01\nTotal Due: $500.00\nVendor: TestCo")
    );
    mockTryAI.mockResolvedValue({
      data: { vendor: "AI Vendor" },
      confidence: 0.99,
      method: "llm",
      documentType: "invoice" as const,
      documentTypeConfidence: 0.9,
    } as any);

    const r = await extract(pngBuffer);
    // regex confidence 0.75 (vendor, inv, date, total) >=0.5 and type confident → should skip AI
    expect(r.data.vendor).not.toBe("AI Vendor");
    // tryAI should not be called due to gate
    expect(mockTryAI).not.toHaveBeenCalled();
  });

  it("gate low confidence calls AI and prefers AI when higher confidence", async () => {
    (config as any).ai.apiKey = "fake-key";
    mockOcr.mockResolvedValue(ocrText("hello world")); // only vendor → confidence 0.25
    mockTryAI.mockResolvedValue({
      data: { vendor: "AI Vendor", invoiceNumber: "AI-123", totalAmount: 999, currency: "USD" },
      confidence: 0.9,
      method: "llm",
      documentType: "invoice" as const,
      documentTypeConfidence: 0.88,
    } as any);

    const r = await extract(pngBuffer);
    expect(mockTryAI).toHaveBeenCalled();
    expect(r.data.vendor).toBe("AI Vendor");
    expect(r.method).toBe("llm");
  });

  it("gate low confidence merges missing fields when AI partially higher", async () => {
    (config as any).ai.apiKey = "fake-key";
    // Regex will get vendor + date (2/4 =0.5) → at threshold, type unknown → needs AI
    mockOcr.mockResolvedValue(ocrText("Acme Corp\n2024-02-01"));
    mockTryAI.mockResolvedValue({
      data: { totalAmount: 123.45, currency: "INR" }, // only total, confidence lower than regex+merge max
      confidence: 0.4,
      method: "llm",
      documentType: "invoice" as const,
      documentTypeConfidence: 0.7,
    } as any);

    const r = await extract(pngBuffer);
    expect(mockTryAI).toHaveBeenCalled();
    // merged should contain both regex vendor and AI total
    expect(r.data.vendor).toBeDefined();
    expect(r.data.totalAmount).toBe(123.45);
    expect(r.method).toMatch(/regex\+llm/);
  });

  it("file path string uses fs.readFile", async () => {
    mockReadFile.mockResolvedValue(pngBuffer as any);
    mockOcr.mockResolvedValue(ocrText("Invoice Number: PATH-1\nTotal: $10.00"));
    const r = await extract("/tmp/fake.png" as any);
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/fake.png");
    expect(r.data.invoiceNumber).toBe("PATH-1");
  });

  it("currency detection INR vs USD vs EUR", async () => {
    mockOcr.mockResolvedValue(ocrText("Invoice Number: C-1\n₹ 1,000.00"));
    let r = await extract(pngBuffer);
    expect(r.data.currency).toBe("INR");

    mockOcr.mockResolvedValue(ocrText("Invoice Number: C-2\n$ 2,000.00"));
    r = await extract(pngBuffer);
    expect(r.data.currency).toBe("USD");

    mockOcr.mockResolvedValue(ocrText("Invoice Number: C-3\n€ 3,000.00"));
    r = await extract(jpgBuffer);
    expect(r.data.currency).toBe("EUR");
  });
});
