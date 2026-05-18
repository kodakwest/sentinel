# AGENTS.md — Sentinel

## Project Context

Sentinel is a clinical pharmacology assistant built on Cloudflare Workers. It provides drug information, FDA label data, and clinical pharmacology insights via "Nurse Clippy" — an AI assistant for registered nurses. Stack: Cloudflare Workers (TypeScript) + D1 + Workers AI + AI Search + Vite/React frontend. Protected assistant and write/admin-adjacent flows are gated by passwordless magic-link auth.

**Deployment:** sentinel-api.kodakwest.workers.dev
**Repo:** kodakwest/sentinel

## Design Conventions

### Visual Identity
- **Dark theme** — background `#0e0f0d` / `#0b0d0e`, panels `#171713`, ink `#e8e6e1`
- **Accent:** Coral/rose for medical — `#e07d5f` primary, `#fb7185` secondary
- **Fonts:** Inter (UI), JetBrains Mono (code), loaded from Google Fonts
- **No build step** — pure HTML/CSS/JS, zero dependencies, works offline

### HTML Artifact Standards
- Single `.html` file, all CSS and SVG inline
- No external dependencies except Google Fonts
- Mobile-responsive via CSS media queries
- Must render in any modern browser
- Dark theme, coral accent, clean clinical feel

### Brand Elements
- **Persona:** Nurse Clippy — direct, clinically precise, no fluff. Speaks like an experienced nurse educator.
- **Tone:** Trustworthy, clinical, warm-but-professional
- **Medical precision** — this is a nursing reference tool, not consumer health

### Login UI
- `src/frontend/login.tsx` owns the magic-link login view.
- Match the existing dark clinical DoseAtlas/Sentinel identity: coral/rose actions, compact clinical copy, Inter UI type, and Nurse Clippy as a subtle supporting brand element.
- Preserve the states users expect in the component: idle, sending, sent/check email, and inline error.

## Auth Conventions

- Auth lives in `src/auth.ts`; runtime table bootstrap lives in `src/bootstrap.ts`; shared hashing/IP/CORS/redirect helpers live in `src/utils.ts`.
- `SESSION_SECRET` is a Wrangler secret, not a `wrangler.toml` var. The Worker should fail hard if it is missing or shorter than 16 characters.
- `AUTH_EMAIL_FROM` is `no-reply@logos-core.com`.
- Magic-link email delivery uses MailChannels first and the Cloudflare `EMAIL` SendEmail binding as a fallback.
- `auth_tokens` and `rate_limits` are self-healed by `ensureSystemSchema()` in `bootstrap.ts`.
- Store only SHA-256 token hashes; never persist raw magic-link tokens.
- Consume tokens atomically and return generic user-facing errors for invalid, expired, missing, or replayed links.
- Session cookies are `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`; sessions are HMAC-signed and short-lived.
- Redirect URLs must remain same-origin relative paths. Reject absolute, protocol-relative, and script URLs.
- Keep admin key auth separate from user session auth.

## Graph Seed Protocol — MANDATORY for all durable docs

YAML frontmatter with artifact_type, source_context, domain, systems, primary_entities, last_updated. Entity relationship format at end.

## Architecture Diagram Colors (SVG)
| Component | Fill | Stroke |
|---|---|---|
| Frontend | rgba(136, 19, 55, 0.4) | #fb7185 |
| Backend/API | rgba(6, 78, 59, 0.4) | #34d399 |
| Database | rgba(76, 29, 149, 0.4) | #a78bfa |
| AI/ML | rgba(251, 146, 60, 0.3) | #fb923c |
| External/FDA | rgba(30, 41, 59, 0.5) | #94a3b8 |
