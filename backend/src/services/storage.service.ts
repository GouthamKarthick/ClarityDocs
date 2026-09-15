import fs from "fs/promises";

export interface StorageSaveResult {
  path: string;
}

export async function saveLocal(file: Express.Multer.File): Promise<StorageSaveResult> {
  return { path: file.path };
}

export async function getFile(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

export function resolveFilename(originalName: string, id: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${id}-${safe}`;
}
