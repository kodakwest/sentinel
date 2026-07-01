---
kind: change_card
project: sentinel
date: 2026-07-01
status: evidenced
commits: [3562a3f, c239d60]
evidence: complete
audience: [reviewer, future-self, security]
release_note: true
tags: [security, secrets, cloudflare, wrangler]
---

# Remove leaked OPENFDA_API_KEY from sentinel (and sibling pharm-mcp)

## What changed
A plaintext OpenFDA API key (`tIdrs6p8…`, 40 chars) was committed in cleartext.
It was removed from every working-tree location and documented as an optional
Wrangler secret.

- `wrangler.toml:27-34` — key deleted from `[vars]`; replaced with a comment
  pointing at `wrangler secret put OPENFDA_API_KEY` (`wrangler.toml`, commit `3562a3f`).
- `SENTINEL_CODEX_SPEC.md:20-23` — `## Credentials` block held a **second**
  cleartext copy of the key plus the Cloudflare Account ID `66ed97…`; replaced
  with provisioning notes (commit `c239d60`).
- `.gitignore` — added `.dev.vars` / `.dev.vars.*` so Wrangler's local secret
  file can't be committed (commit `3562a3f`).

Diff scope: `git diff --stat 4c745ed..c239d60` → 3 files, +7/-3.

## Why it's behavior-neutral
The key is **dead config**. Its only reader, `src/openfda.ts:23`
(`fetchOpenFdaDrug(name, apiKey)`), is never imported anywhere in the repo
(`git grep "from './openfda'"` → 0 hits). The live enrichment path is
`src/fda.ts:774 fetchOpenFdaLabels(search)`, which calls
`https://api.fda.gov/drug/label.json` with **no** `api_key` param. OpenFDA
serves keyless requests (only rate limits differ). Removal changes no runtime
behavior.

## Verification
- `git grep --no-index 'tIdrs6p8…'` in the working tree → **0 matches** after the
  edits (was 2 files pre-fix).
- `git status --porcelain` → clean.
- Pushed: `git push origin main` → `4c745ed..c239d60  main -> main`; `main` ==
  `origin/main`.

## Not done (intentional)
- Git **history** still contains the key (introduced in `5ac3929`, present on
  `main` and `origin/jules-rebrand-moodboard-*`). See decision record
  `2026-07-01-decision_record-skip-history-scrub`.
- Key **rotation** is the actual remediation and is a user action — see risk note
  `2026-07-01-risk_gap_note-residual-secret-exposure`.
