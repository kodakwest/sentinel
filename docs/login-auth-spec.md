---
title: Sentinel Login Auth Spec
artifact_type: Historical_Specification
source_context: Original magic-link auth implementation request; updated after implementation refactor
domain: Pharmacology; Nursing; Authentication; Cloudflare Workers
systems: Cloudflare Workers; D1; SendEmail; MailChannels; React
primary_entities: Sentinel; DoseAtlas; Nurse Clippy; Auth System; Magic Link; Session Cookie
status: superseded
last_updated: 2026-05-18
---

# Sentinel Login Auth Spec

> Status: superseded. This document began as the build spec for the login/auth work. The final implementation evolved during the auth refactor and now uses the architecture described below. Keep this file as historical context, not as the source of truth for future auth changes.

## Final Architecture

Sentinel uses passwordless magic-link authentication for the React SPA and protected API routes. The implementation lives in:

- `src/auth.ts` — magic-link request, token consumption, session signing, session verification, logout cookie helpers
- `src/bootstrap.ts` — runtime D1 bootstrap for auth/system tables
- `src/utils.ts` — shared `sha256()`, `clientIp()`, `corsHeaders()`, `sanitizeRedirectUrl()`, and base64url helpers
- `src/frontend/login.tsx` — dark-themed DoseAtlas login component with the magic-link flow
- `src/index.ts` — auth routes and API protection

## Routes

| Route | Method | Purpose |
|---|---:|---|
| `/api/auth/login` | `POST` | Accepts `{ email, redirectUrl? }`, rate-limits the request, stores a hashed magic-link token, and sends email. |
| `/api/auth/login?token=...` | `GET` | Atomically consumes the token, sets the session cookie, and redirects to a sanitized same-origin path. |
| `/api/auth/logout` | `POST` | Clears the session cookie and returns `{ success: true }`. |
| `/api/auth/me` | `GET` | Returns `{ email }` for an authenticated request, otherwise `401`. |

The SPA login route is served by the built frontend assets. Public API routes remain available for status and read-only reference data. Protected APIs such as `/api/ask`, `/api/explain`, and `/api/ingest` require a valid session, while `/api/admin/*` still uses the separate admin key flow.

## Magic-Link Flow

1. The login UI collects an email address and posts it to `/api/auth/login`.
2. `requestMagicLink()` normalizes the email, applies per-IP and per-email rate limits, creates a 32-byte random token, stores only its SHA-256 hash in D1, and sends a 15-minute login link.
3. Email delivery uses the MailChannels transaction API first. If MailChannels fails and the Cloudflare `EMAIL` SendEmail binding is present, Sentinel attempts that fallback.
4. The emailed link points to `/api/auth/login?token=...`.
5. `consumeMagicLink()` hashes the token and atomically updates the matching D1 row from unconsumed to consumed with `UPDATE ... WHERE consumed_at IS NULL ... RETURNING`.
6. On success, Sentinel sets a signed `__Host-session` cookie and redirects to `/` or a sanitized local redirect path.

## Configuration

`SESSION_SECRET` is a Wrangler secret, not a `[vars]` value. The Worker fails hard at runtime if it is missing or shorter than 16 characters.

```bash
wrangler secret put SESSION_SECRET
```

`AUTH_EMAIL_FROM` is configured as:

```toml
AUTH_EMAIL_FROM = "no-reply@logos-core.com"
```

`wrangler.toml` includes an optional SendEmail binding fallback:

```toml
[[send_email]]
name = "EMAIL"
```

## D1 Tables

`src/bootstrap.ts` self-heals required auth tables at runtime:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  redirect_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_purpose ON auth_tokens(purpose, expires_at);
```

## Security Notes

- `SESSION_SECRET` is enforced before request handling continues.
- Sessions use HMAC-SHA-256 signatures and 24-hour expiry.
- Session cookies are `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`.
- Magic links expire after 15 minutes.
- Tokens are stored as SHA-256 hashes, never as raw bearer tokens.
- Token consumption is atomic to prevent replay.
- Redirect targets are restricted to same-origin relative paths; protocol-relative, absolute, and `javascript:` URLs are rejected.
- Invalid, expired, already-consumed, and missing tokens all surface the same generic user-facing message: `Invalid or expired link.`
- Magic-link requests are limited to 3 per email per hour and 10 per IP per hour.
- General non-admin, non-auth API rate limiting uses the shared `rate_limits` table.

## Historical Deltas From Original Spec

- The project name in the original request was DoseAtlas; the deployed product context is Sentinel/DoseAtlas with Nurse Clippy.
- MailChannels is now primary for email delivery; Cloudflare SendEmail is a fallback, not the only path.
- `SESSION_SECRET` moved out of `wrangler.toml` vars and into Wrangler secrets.
- `AUTH_EMAIL_FROM` changed from the original `noreply@doseatlas.app` to `no-reply@logos-core.com`.
- `rate_limits` and `auth_tokens` are created by `src/bootstrap.ts`; migrations may still exist, but runtime bootstrap is authoritative for system table presence.
- Shared helpers were deduplicated into `src/utils.ts`.

## Entity Relationships

- Auth System -> implemented_in -> `src/auth.ts`
- Auth System -> bootstraps_tables_with -> `src/bootstrap.ts`
- Auth System -> uses_helpers_from -> `src/utils.ts`
- Auth System -> renders_login_with -> `src/frontend/login.tsx`
- Auth System -> stores_tokens_in -> `auth_tokens`
- Auth System -> limits_requests_with -> `rate_limits`
- Magic Link -> delivered_by -> MailChannels
- Magic Link -> fallback_delivery -> SendEmail binding
- Session Cookie -> signed_with -> `SESSION_SECRET`
