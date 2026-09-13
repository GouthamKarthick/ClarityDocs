const API_BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  status: number;
  code?: string;
  duplicateOf?: string;
  constructor(message: string, status: number, code?: string, duplicateOf?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.duplicateOf = duplicateOf;
  }
}

export async function uploadDocument(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/documents/upload`, {
    method: "POST",
    body: fd,
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    throw new ApiError(body.error || "Upload failed", res.status, body.code, body.duplicateOf);
  }
  // 409 is handled as error above, but keep for success shape
  return body as { id: string; name: string; status: string; created_at: string; document_type?: string; data?: unknown };
}

export async function listDocuments(
  limit = 20,
  offset = 0,
  opts?: { q?: string; document_type?: string }
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (opts?.q) params.set("q", opts.q);
  if (opts?.document_type) params.set("document_type", opts.document_type);
  const res = await fetch(`${API_BASE}/api/documents?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || "Failed to list", res.status, body.code);
  }
  return (await res.json()) as { documents: import("../types/index.js").Document[]; total: number; limit: number; offset: number };
}

export async function getDocument(id: string) {
  const res = await fetch(`${API_BASE}/api/documents/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || "Not found", res.status, (body as { code?: string }).code);
  }
  return (await res.json()) as import("../types/index.js").Document;
}
