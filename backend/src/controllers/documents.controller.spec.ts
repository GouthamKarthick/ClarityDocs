import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("../services/extraction.service.js", () => ({ extract: vi.fn() }));
vi.mock("../services/dedup.service.js", () => ({ findDuplicateByContent: vi.fn() }));

import { pool } from "../db/pool.js";
import { extract } from "../services/extraction.service.js";
import { findDuplicateByContent } from "../services/dedup.service.js";
import { uploadDocument, listDocuments, getDocument } from "./documents.controller.js";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("controller — uploadDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 when no file", async () => {
    const res = mockRes();
    await uploadDocument({ user: { id: "test-user", email: "test@example.com" } } as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("inline flow: pending→processing→done, returns 201", async () => {
    const mockQuery = vi.mocked(pool.query);
    // INSERT pending, SELECT created_at, UPDATE processing, extract, dedup, UPDATE done, final 201
    mockQuery
      .mockResolvedValueOnce([[]] as any) // INSERT
      .mockResolvedValueOnce([[{ created_at: new Date().toISOString() }]] as any) // SELECT created_at
      .mockResolvedValueOnce([[]] as any) // UPDATE processing
      .mockResolvedValueOnce([[]] as any); // UPDATE done
    vi.mocked(extract).mockResolvedValue({ data: { vendor: "V", invoiceNumber: "INV1", totalAmount: 10, currency: "INR" }, confidence: 1, method: "regex", documentType: "invoice", documentTypeConfidence: 0.9 } as any);
    vi.mocked(findDuplicateByContent).mockResolvedValue({ duplicate: false } as any);

    const req: any = { user: { id: "test-user", email: "test@example.com" }, file: { filename: "550e8400-e29b-41d4-a716-446655440000-test.pdf", originalname: "test.pdf", path: "/tmp/test" } };
    const res = mockRes();
    await uploadDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }));
  });

  it("duplicate → 409", async () => {
    const mockQuery = vi.mocked(pool.query);
    mockQuery.mockResolvedValueOnce([[]] as any).mockResolvedValueOnce([[{ created_at: new Date().toISOString() }]] as any).mockResolvedValueOnce([[]] as any).mockResolvedValueOnce([[]] as any);
    vi.mocked(extract).mockResolvedValue({ data: { vendor: "V", invoiceNumber: "DUP", totalAmount: 10, currency: "USD" }, confidence: 1, method: "regex", documentType: "receipt", documentTypeConfidence: 0.85 } as any);
    vi.mocked(findDuplicateByContent).mockResolvedValue({ duplicate: true, duplicateOf: "existing-id" } as any);

    const req: any = { user: { id: "test-user", email: "test@example.com" }, file: { filename: "550e8400-e29b-41d4-a716-446655440000-dup.pdf", originalname: "dup.pdf", path: "/tmp/dup" } };
    const res = mockRes();
    await uploadDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "DUPLICATE_CONTENT" }));
  });
});

describe("controller — listDocuments / getDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listDocuments handles q escape and document_type filter", async () => {
    const mockQuery = vi.mocked(pool.query);
    mockQuery.mockResolvedValueOnce([[{ cnt: 1 }]] as any).mockResolvedValueOnce([[{ id: "a", name: "x", data: null }]] as any);
    const req: any = { user: { id: "test-user", email: "test@example.com" }, query: {}, _pagination: { limit: 10, offset: 0, q: "100%_test", document_type: "invoice" } };
    const res: any = { json: vi.fn() };
    await listDocuments(req, res, vi.fn());
    expect(mockQuery).toHaveBeenCalled();
    const countSql = mockQuery.mock.calls[0][0] as unknown as string;
    expect(countSql).toContain("name LIKE ?");
    expect(countSql).toContain("document_type = ?");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
  });

  it("getDocument 400 invalid uuid", async () => {
    const res = mockRes();
    await getDocument({ params: { id: "bad" }, user: { id: "test-user", email: "test@example.com" } } as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("getDocument 404 when not found", async () => {
    vi.mocked(pool.query).mockResolvedValue([[]] as any);
    const res = mockRes();
    await getDocument({ params: { id: "550e8400-e29b-41d4-a716-446655440000" }, user: { id: "test-user", email: "test@example.com" } } as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("getDocument 200 returns parsed data", async () => {
    vi.mocked(pool.query).mockResolvedValue([[{ id: "550e8400-e29b-41d4-a716-446655440000", name: "x", data: JSON.stringify({ vendor: "V" }), status: "done" }]] as any);
    const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await getDocument({ params: { id: "550e8400-e29b-41d4-a716-446655440000" }, user: { id: "test-user", email: "test@example.com" } } as any, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { vendor: "V" } }));
  });
});
