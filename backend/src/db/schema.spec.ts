import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./pool.js", () => ({
  pool: { query: vi.fn().mockResolvedValue([[{ cnt: 1 }]]) },
}));

import { pool } from "./pool.js";
import { ensureSchema } from "./schema.js";

describe("db/schema — ensureSchema", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates documents table and runs migrations", async () => {
    const mockQuery = vi.mocked(pool.query);
    await ensureSchema();
    // First call is CREATE TABLE
    expect(mockQuery).toHaveBeenCalled();
    const firstCall = mockQuery.mock.calls[0][0] as unknown as string;
    expect(firstCall).toContain("CREATE TABLE IF NOT EXISTS documents");
    expect(firstCall).toContain("idx_status_created");
  });

  it("tolerates migration errors", async () => {
    const mockQuery = vi.mocked(pool.query);
    // CREATE TABLE succeeds, later INFORMATION_SCHEMA query fails but is caught
    mockQuery.mockResolvedValueOnce([[]] as any); // CREATE
    mockQuery.mockRejectedValueOnce(new Error("already exists")); // first SELECT migration fails
    await expect(ensureSchema()).resolves.toBeUndefined();
  });
});
