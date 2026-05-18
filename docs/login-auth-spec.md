Create a complete login/auth screen and magic-link authentication flow for DoseAtlas, a clinical pharmacology reference app for nurses.

The app is deployed as a Cloudflare Worker (TypeScript) with D1 database, Workers AI, and static assets (Vite/React frontend).

## Design Context

The DoseAtlas brand is already implemented:
- Dark theme (#0e0f0d bg, #1a1c18 surface)
- Rose accent (#fb7185), coral secondary (#e07d5f)
- Brand mark: clipboard + health cross SVG (inline)
- Nurse Clippy: the AI assistant persona (clipboard with eyes icon)
- Tagline: "Medication knowledge mapped for nurses."

## What to Build

### 1. Login Screen UI (`src/frontend/login.tsx`)

A dark-themed login page that:
- Shows the DoseAtlas brand mark SVG and product name at top
- Has a single email input field (no password — magic link flow)
- "Send magic link" button
- States: idle → sending → sent (check your email) → error
- Matches DoseAtlas branding: clipboard icons, rose/coral accents, Inter font
- Shows Nurse Clippy personality subtly — maybe a small "with Nurse Clippy" tag or the Nurse Clippy icon (clipboard with eyes)
- Mobile-responsive
- On success, shows "Check your email" message with a nice animation/icon
- On error, shows the error inline

### 2. Auth Middleware (`src/auth.ts`)

Implement magic-link auth (same pattern as logos-core at kodakwest/logos-core/src/auth.ts):
- `requestMagicLink(env, email, request)` — generates token, stores SHA-256 hash in D1, sends email
- `consumeMagicLink(env, token)` — validates + consumes token, creates session
- `authenticateRequest(request, env)` — checks session cookie
- `requireAuth(request, env)` — returns 401 if not authenticated, redirects to login
- D1 tables: `auth_tokens` (token_hash, email, purpose, issued_at, expires_at, consumed_at, redirect_url)
- Rate limiting: 3 magic links per email per hour, 10 per IP per hour (use the existing `rate_limits` table)

### 3. Update `src/index.ts` — Auth Routes & Middleware

Add routes:
- `GET /login` — serves the login page (if not authenticated) or redirects to /
- `POST /api/auth/login` — sends magic link
- `GET /api/auth/login` — consumes magic link token, sets session cookie, redirects
- `POST /api/auth/logout` — clears session
- `GET /api/auth/me` — returns current user info (or 401)

Protect the app with `requireAuth()` — redirect unauthenticated users to /login.
Public routes (no auth needed): /api/status, /api/drugs/search (GET), /api/drugs/* (GET), /api/conditions/* (GET)
Protected routes (auth required): /api/ask (POST), /api/explain (POST), /api/admin/*, the main SPA

### 4. Update `src/frontend/app.tsx`

Add login state awareness:
- If user is not authenticated (check /api/auth/me on load), show login page instead of main app
- If authenticated, show the main app as-is with the DoseAtlas branding
- Add logout button somewhere (maybe in the header or settings area)

### 5. Update `wrangler.toml`

Add send_email binding:
```toml
[[send_email]]
name = "EMAIL"
```

Add env vars:
```toml
AUTH_EMAIL_FROM = "noreply@doseatlas.app"
SESSION_SECRET = "doseatlas-session-secret-key"
```

### 6. D1 Migration

Create `src/migrations/0004_auth_tokens.sql`:
```sql
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

## Implementation Notes

- Use the same `crypto.subtle.digest("SHA-256")` pattern as logos-core for token hashing
- Session cookie: `__Host-session`, HttpOnly, Secure, SameSite=Lax, 24hr TTL
- Magic link TTL: 15 minutes
- Token generation: 32 random bytes, base64url-encoded
- Email sending: use Cloudflare's `send_email` binding
- The login page should be a React component that replaces the main app render when not authenticated
- No password, no signup — just email → magic link → session
- The `rate_limits` table already exists (created by the CORS/rate limiting code), so just add `auth_tokens`

## Files to Create
- `src/frontend/login.tsx` — Login page component
- `src/auth.ts` — Auth logic (magic link, session, rate limiting)
- `src/migrations/0004_auth_tokens.sql` — D1 migration

## Files to Modify
- `src/index.ts` — Add auth routes + middleware
- `src/frontend/app.tsx` — Add auth state, show login when needed
- `wrangler.toml` — Add email binding + auth vars
- `src/types.ts` — Add AuthUser type if not already there
- `AGENTS.md` — Update with auth conventions (optional)

## Constraints
- Keep Nurse Clippy as the AI persona
- Match existing DoseAtlas visual identity (dark, rose/coral, Inter)
- Don't break existing drug search, drug dossier, assistant panel, or admin endpoints
- Admin endpoints already have X-Admin-Secret auth — keep that separate
- The existing CORS and rate limiting code should remain intact
