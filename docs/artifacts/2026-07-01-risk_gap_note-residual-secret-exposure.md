---
kind: risk_gap_note
project: sentinel
date: 2026-07-01
status: evidenced
commits: [3562a3f, c239d60]
evidence: complete
audience: [reviewer, future-self, security]
release_note: false
tags: [security, secrets, follow-up]
---

# Residual secret exposure & open follow-ups

## Accepted risk (owner decision 2026-07-01)
1. **OpenFDA key exposure — ACCEPTED, will not rotate.** The key (`tIdrs6p8…`)
   is a free OpenFDA **rate-limit token**: no billing, no PII, no account access
   attached. Worst case if abused is quota exhaustion (HTTP 429), and the app
   runs fine keyless, so even that is a non-event. Owner judged rotation not
   worth it. Documented here so the exposure is a known, accepted state — not an
   oversight.
2. **Key remains in git history** (`5ac3929`+) on `main` and
   `origin/jules-rebrand-moodboard-*`. Left in place; acceptable given #1.
   Ref: `2026-07-01-decision_record-skip-history-scrub`.

## Open follow-ups (optional, non-blocking)
1. **🟡 CF Account ID `66ed97…` hardcoded as a fallback default** in
   `seed_all_batches.py:5`, `seed_curated.py:6`, `seed_d1.py:6`
   (`os.environ.get("CF_ACCOUNT_ID", "66ed97…")`). An identifier, not a
   credential (needs an API token to use), so low severity — but could be made
   env-only. NOT changed this session (would alter seed-script behavior).
2. **Optional:** if higher OpenFDA rate limits are ever wanted, set a fresh key
   via `wrangler secret put OPENFDA_API_KEY` (both Workers). Not needed for
   normal operation.

## Verified clean (no action)
- `SESSION_SECRET`, `ADMIN_SECRET` — read from `env` only (`src/auth.ts:7`,
  `src/index.ts:663`); never hardcoded.
- pharm-mcp AI Search endpoint `mcp.ts:115` — instance-UUID URL, called with no
  `Authorization` header; an identifier, not a credential (but note: the call is
  unauthenticated — architecture concern, not a secret leak).
- pharm-mcp KV namespace id (`wrangler.toml:13`) — a binding identifier, standard
  to commit.
