import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

export interface StorageSaveResult {
  path: string;
  s3Key?: string;
}

// Phase1: local disk. Phase2: S3 adapter will replace this impl behind same interface.
export async function saveLocal(file: Express.Multer.File): Promise<StorageSaveResult> {
  // multer already wrote to disk (diskStorage), file.path is the stored path
  return { path: file.path };
}

export async function getFile(filePath: string): Promise<Buffer> {
  // Phase1 local
  if (filePath.startsWith("s3://")) {
    throw new Error("S3 get not implemented in Phase1");
  }
  return fs.readFile(filePath);
}

export function resolveFilename(originalName: string, id: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${id}-${safe}`;
}
