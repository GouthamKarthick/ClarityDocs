const API_BASE = import.meta.env.VITE_API_URL || "";

export async function register(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || "Register failed", res.status);
  return body as { id: string; email: string };
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || "Login failed", res.status);
  return body;
}

export async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function me() {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    credentials: "include",
  });
  if (!res.ok) throw new ApiError("Not authenticated", res.status);
  return (await res.json()) as {
    id: string;
    email: string;
    email_verified: number;
    created_at: string;
  };
}

export async function getSummary() {
  const res = await fetch(`${API_BASE}/api/documents/summary`, {
    credentials: "include",
  });
  if (!res.ok) throw new ApiError("Summary failed", res.status);
  return (await res.json()) as {
    totalDocs: number;
    sumTotal: number;
    avgUsage: number;
    avgConfidence: number;
    byType: { document_type: string; cnt: number; sum: number }[];
    trend: { date: string; cnt: number; sum: number }[];
    topVendors: { vendor: string; cnt: number; sum: number }[];
  };
}

export async function exportSummary(format: "pdf" | "csv" = "pdf") {
  const res = await fetch(
    `${API_BASE}/api/documents/summary/export?format=${format}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new ApiError("Export failed", res.status);
  return await res.blob();
}

export async function forgotPassword(email: string) {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  return body;
}

export async function resetPassword(token: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || "Reset failed", res.status);
  return body;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  duplicateOf?: string;
  constructor(
    message: string,
    status: number,
    code?: string,
    duplicateOf?: string,
  ) {
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
    credentials: "include",
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    throw new ApiError(
      body.error || "Upload failed",
      res.status,
      body.code,
      body.duplicateOf,
    );
  }
  // 409 is handled as error above, but keep for success shape
  return body as {
    id: string;
    name: string;
    status: string;
    created_at: string;
    document_type?: string;
    data?: unknown;
  };
}

export async function listDocuments(
  limit = 20,
  offset = 0,
  opts?: { q?: string; document_type?: string },
) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  if (opts?.q) params.set("q", opts.q);
  if (opts?.document_type) params.set("document_type", opts.document_type);

  const res = await fetch(`${API_BASE}/api/documents?${params.toString()}`, {
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || "Failed to list", res.status, body.code);
  }

  return (await res.json()) as {
    documents: import("../types/index.js").Document[];
    total: number;
    limit: number;
    offset: number;
  };
}

export async function getDocument(id: string) {
  const res = await fetch(`${API_BASE}/api/documents/${id}`, {
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    
    throw new ApiError(
      body.error || "Not found",
      res.status,
      (body as { code?: string }).code,
    );
  }
  return (await res.json()) as import("../types/index.js").Document;
}
