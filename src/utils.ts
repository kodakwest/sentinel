import type { Env } from "./types";

export function encodeBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

export function sanitizeRedirectUrl(redirectUrl?: string | null): string | undefined {
  const value = redirectUrl?.trim();
  if (!value) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;

  try {
    const decoded = decodeURIComponent(value).trim().toLowerCase();
    if (
      decoded.startsWith("//")
      || decoded.startsWith("http://")
      || decoded.startsWith("https://")
      || decoded.startsWith("javascript:")
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return value;
}

function corsOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin");
  const allowed = ((env as Env & { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS || "https://sentinel-api.kodakwest.workers.dev")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) return origin;
  return "null";
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": corsOrigin(request, env),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret, X-Admin-Key, Authorization"
  };
}
