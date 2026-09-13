import { describe, it, expect } from "vitest";
import { resolveFilename, getFile } from "./storage.service.js";
import fs from "fs/promises";

describe("storage.service", () => {
  it("resolveFilename sanitizes unsafe chars and prefixes id", () => {
    expect(resolveFilename("my invoice.pdf", "uuid-123")).toBe("uuid-123-my_invoice.pdf");
    expect(resolveFilename("a/b\\c", "id")).toBe("id-a_b_c");
  });

  it("saveLocal returns file.path (phase1)", async () => {
    const { saveLocal } = await import("./storage.service.js");
    const r = await saveLocal({ path: "/tmp/uuid-foo.pdf" } as any);
    expect(r.path).toBe("/tmp/uuid-foo.pdf");
  });

  it("getFile throws for s3:// in Phase1", async () => {
    await expect(getFile("s3://bucket/key")).rejects.toThrow(/S3 get not implemented/);
  });

  it("getFile reads local file", async () => {
    const tmp = `/tmp/storage-spec-${Date.now()}.txt`;
    await fs.writeFile(tmp, "hello");
    const buf = await getFile(tmp);
    expect(buf.toString()).toBe("hello");
    await fs.unlink(tmp);
  });
});
