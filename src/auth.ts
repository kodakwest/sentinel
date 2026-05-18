import type { Env } from "./types";
import { clientIp, corsHeaders, encodeBase64Url, sanitizeRedirectUrl, sha256 } from "./utils";

const GENERIC_LINK_ERROR = "Invalid or expired link.";

export function sessionSecret(env: Env): string {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set as a Wrangler secret and be at least 16 characters.");
  }
  return secret;
}

export function assertAuthConfig(env: Env): void {
  sessionSecret(env);
}

export async function requestMagicLink(env: Env, email: string, request: Request, redirectUrl?: string): Promise<{ success: boolean; error?: string }> {
  sessionSecret(env);

  const ip = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / 3600) * 3600;
  const ipBucket = `rl:ip:auth:${await sha256(ip)}:${windowStart}`;
  const emailBucket = `rl:email:auth:${await sha256(email)}:${windowStart}`;

  const ipRow = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(bucket_key) DO UPDATE SET count = CASE WHEN rate_limits.window_start < excluded.window_start THEN 1 ELSE rate_limits.count + 1 END, window_start = CASE WHEN rate_limits.window_start < excluded.window_start THEN excluded.window_start ELSE rate_limits.window_start END RETURNING count`
  ).bind(ipBucket, windowStart).first<{ count: number }>();

  if (ipRow && ipRow.count > 10) return { success: false, error: "Too many attempts from this IP. Try again later." };

  const emailRow = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(bucket_key) DO UPDATE SET count = CASE WHEN rate_limits.window_start < excluded.window_start THEN 1 ELSE rate_limits.count + 1 END, window_start = CASE WHEN rate_limits.window_start < excluded.window_start THEN excluded.window_start ELSE rate_limits.window_start END RETURNING count`
  ).bind(emailBucket, windowStart).first<{ count: number }>();

  if (emailRow && emailRow.count > 3) return { success: false, error: "Too many magic link requests. Try again later." };

  const rawTokenBytes = new Uint8Array(32);
  crypto.getRandomValues(rawTokenBytes);
  const tokenStr = encodeBase64Url(rawTokenBytes.buffer);
  const tokenHash = await sha256(tokenStr);

  const expiresAt = now + 15 * 60; // 15 mins

  await env.DB.prepare(
    `INSERT INTO auth_tokens (token_hash, email, purpose, issued_at, expires_at, redirect_url) VALUES (?, ?, 'magic_link', ?, ?, ?)`
  ).bind(tokenHash, email, now, expiresAt, sanitizeRedirectUrl(redirectUrl) || null).run();

  const url = new URL(request.url);
  const loginUrl = `${url.origin}/api/auth/login?token=${tokenStr}`;
  await sendMagicLinkEmail(env, email, loginUrl);

  return { success: true };
}

export async function consumeMagicLink(env: Env, token: string): Promise<{ email?: string; redirectUrl?: string; error?: string }> {
  sessionSecret(env);

  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);

  const consumed = await env.DB.prepare(
    `UPDATE auth_tokens
     SET consumed_at = ?
     WHERE token_hash = ?
       AND purpose = 'magic_link'
       AND consumed_at IS NULL
       AND expires_at >= ?
     RETURNING email, redirect_url`
  ).bind(now, tokenHash, now).first<{ email: string; redirect_url: string | null }>();

  if (!consumed) {
    const row = await env.DB.prepare(
      `SELECT expires_at, consumed_at FROM auth_tokens WHERE token_hash = ? AND purpose = 'magic_link'`
    ).bind(tokenHash).first<{ expires_at: number; consumed_at: number | null }>();
    const reason = !row ? "invalid" : row.consumed_at ? "already_consumed" : row.expires_at < now ? "expired" : "not_consumed";
    console.error("Magic link consumption failed", { reason });
    return { error: GENERIC_LINK_ERROR };
  }

  return { email: consumed.email, redirectUrl: sanitizeRedirectUrl(consumed.redirect_url) };
}

// Session Helpers
async function signSession(email: string, secret: string, expiresAt: number): Promise<string> {
  const payload = `${email}:${expiresAt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  const payloadBytes = new TextEncoder().encode(payload);
  return `${encodeBase64Url(payloadBytes.buffer)}.${sigHex}`;
}

async function verifySession(token: string, secret: string): Promise<{ email: string; expiresAt: number } | null> {
  try {
    const [payloadB64, sigHex] = token.split(".");
    if (!payloadB64 || !sigHex) return null;
    
    // Decode payload
    const payloadStr = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const [email, expiresAtStr] = payloadStr.split(":");
    const expiresAt = parseInt(expiresAtStr, 10);
    
    if (!email || isNaN(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

    const payload = `${email}:${expiresAt}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));

    if (isValid) return { email, expiresAt };
    return null;
  } catch {
    return null;
  }
}

export async function createSessionCookie(env: Env, email: string): Promise<string> {
  const secret = sessionSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60; // 24 hours
  const token = await signSession(email, secret, expiresAt);
  const expiresDate = new Date(expiresAt * 1000).toUTCString();
  return `__Host-session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${expiresDate}`;
}

export function clearSessionCookie(): string {
  return `__Host-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export async function authenticateRequest(request: Request, env: Env): Promise<{ email: string } | null> {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/__Host-session=([^;]+)/);
  if (!match) return null;

  const sessionToken = match[1];
  const secret = sessionSecret(env);

  const session = await verifySession(sessionToken, secret);
  if (session) return { email: session.email };
  
  return null;
}

export async function requireAuth(request: Request, env: Env): Promise<{ email: string } | Response> {
  const user = await authenticateRequest(request, env);
  if (user) return user;
  
  return new Response(JSON.stringify({ error: "Unauthorized" }), { 
    status: 401, 
    headers: { ...corsHeaders(request, env), "Content-Type": "application/json" } 
  });
}

async function sendMagicLinkEmail(env: Env, email: string, loginUrl: string): Promise<void> {
  const from = env.AUTH_EMAIL_FROM || "no-reply@logos-core.com";
  const subject = "Sign in to DoseAtlas";
  const text = `Click this link to sign in to DoseAtlas: ${loginUrl}\n\nLink expires in 15 minutes.`;
  const html = [
    "<!doctype html>",
    "<html><body>",
    "<p>Click this link to sign in to DoseAtlas:</p>",
    `<p><a href="${escapeHtml(loginUrl)}">Sign in to DoseAtlas</a></p>`,
    "<p>This link expires in 15 minutes.</p>",
    "</body></html>"
  ].join("");

  const mailChannelsPayload = {
    personalizations: [{ to: [{ email }] }],
    from: { email: from, name: "DoseAtlas" },
    subject,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html }
    ]
  };

  try {
    const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mailChannelsPayload)
    });
    if (response.ok) return;

    console.error("MailChannels rejected magic link email", {
      status: response.status,
      body: await response.text().catch(() => "")
    });
  } catch (error) {
    console.error("MailChannels magic link email failed", error);
  }

  if (!env.EMAIL) return;

  try {
    await env.EMAIL.send({ from, to: email, subject, text, html });
  } catch (error) {
    console.error("SendEmail fallback magic link email failed", error);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}
