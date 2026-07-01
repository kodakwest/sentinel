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

## Open risks / pending user actions
1. **🔴 Rotate the OpenFDA key** (`tIdrs6p8…`) at
   https://open.fda.gov/apis/authentication/ — it was public on GitHub and is
   compromised regardless of the working-tree cleanup. Blocking item; only the
   user can do this. App runs fine keyless.
2. **Key remains in git history** (`5ac3929`+) on `main` and
   `origin/jules-rebrand-moodboard-*`. Not scrubbed by decision — safe only once
   #1 is done. Ref: `2026-07-01-decision_record-skip-history-scrub`.
3. **🟡 CF Account ID `66ed97…` hardcoded as a fallback default** in
   `seed_all_batches.py:5`, `seed_curated.py:6`, `seed_d1.py:6`
   (`os.environ.get("CF_ACCOUNT_ID", "66ed97…")`). An identifier, not a
   credential (needs an API token to use), so low severity — but recommend making
   it env-only. NOT changed this session (would alter seed-script behavior).
4. **After rotating**, re-add via `wrangler secret put OPENFDA_API_KEY` for both
   `sentinel-api` and `pharm-mcp-gateway` if higher rate limits are wanted.

## Verified clean (no action)
- `SESSION_SECRET`, `ADMIN_SECRET` — read from `env` only (`src/auth.ts:7`,
  `src/index.ts:663`); never hardcoded.
- pharm-mcp AI Search endpoint `mcp.ts:115` — instance-UUID URL, called with no
  `Authorization` header; an identifier, not a credential (but note: the call is
  unauthenticated — architecture concern, not a secret leak).
- pharm-mcp KV namespace id (`wrangler.toml:13`) — a binding identifier, standard
  to commit.
