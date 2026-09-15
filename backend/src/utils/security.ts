const SQL_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b)/i,
  /(\bSELECT\b.*\bFROM\b)/i,
  /(\bINSERT\b.*\bINTO\b)/i,
  /(\bDELETE\b.*\bFROM\b)/i,
  /(\bDROP\b.*\bTABLE\b)/i,
  /(\bUPDATE\b.*\bSET\b)/i,
  /(--\s)/,
  /(;\s*--)/,
  /(\bOR\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+)/i,
  /(\bEXEC\b|\bEXECUTE\b)/i,
  /(\bINFORMATION_SCHEMA\b)/i,
];

const XSS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /<iframe/i,
  /<img[^>]*onerror/i,
];

const PATH_PATTERNS = [/\.\.\//, /\.\.\\/, /%2e%2e/i];

export function isSuspicious(input: string | undefined | null): boolean {
  if (!input || typeof input !== "string") return false;
  const s = input.toString();
  if (s.length > 1000) return true; // overly long
  for (const p of [...SQL_PATTERNS, ...XSS_PATTERNS, ...PATH_PATTERNS]) {
    if (p.test(s)) return true;
  }
  // multiple SQL separators
  if ((s.match(/;/g) || []).length > 1 && /SELECT|INSERT|DELETE/i.test(s)) return true;
  return false;
}

export function sanitize(value: string, maxLen = 500): string {
  let v = value.trim().slice(0, maxLen);
  // strip angle brackets to prevent XSS in names
  v = v.replace(/[<>]/g, "");
  return v;
}

export function validateField(name: string, value: string | undefined, maxLen = 255): { ok: boolean; reason?: string } {
  if (isSuspicious(value)) return { ok: false, reason: `Suspicious content detected in ${name}` };
  if ((value?.length ?? 0) > maxLen) return { ok: false, reason: `${name} too long` };
  return { ok: true };
}
