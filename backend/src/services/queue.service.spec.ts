import { describe, it, expect, vi } from "vitest";

describe("queue.service — enqueue", () => {
  it("no-ops when EXTRACTION_MODE != queue", async () => {
    vi.resetModules();
    vi.doMock("../config.js", async () => {
      const orig: any = await vi.importActual("../config.js");
      return { ...orig, config: { ...orig.config, extractionMode: "inline" } };
    });
    const { enqueue } = await import("./queue.service.js");
    await expect(enqueue({ docId: "a", s3Key: "k" })).resolves.toBeUndefined();
  });

  it("throws when queue mode but SQS_QUEUE_URL missing", async () => {
    vi.resetModules();
    vi.doMock("../config.js", async () => {
      const orig: any = await vi.importActual("../config.js");
      return { ...orig, config: { ...orig.config, extractionMode: "queue", sqsQueueUrl: undefined, awsRegion: "ap-south-1" } };
    });
    const { enqueue } = await import("./queue.service.js");
    await expect(enqueue({ docId: "a", s3Key: "k" })).rejects.toThrow(/SQS_QUEUE_URL/);
  });

  it("throws when AWS SDK not installed", async () => {
    vi.resetModules();
    vi.doMock("../config.js", async () => {
      const orig: any = await vi.importActual("../config.js");
      return { ...orig, config: { ...orig.config, extractionMode: "queue", sqsQueueUrl: "https://sqs.test/q", awsRegion: "ap-south-1" } };
    });
    const { enqueue } = await import("./queue.service.js");
    await expect(enqueue({ docId: "a", s3Key: "k" })).rejects.toThrow(/AWS SDK not installed/);
  });
});
