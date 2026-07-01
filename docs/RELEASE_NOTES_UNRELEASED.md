# Unreleased — release-note candidates

Candidates are harvested as work happens. Compile with `session-artifact compile`.

---

## Security: leaked OpenFDA API key removed (2026-07-01)

Source atom: `docs/artifacts/2026-07-01-change_card-openfda-key-remediation.md`
Commits: `3562a3f`, `c239d60`

- **internal/technical:** Removed a cleartext OpenFDA API key from
  `wrangler.toml` `[vars]` and a second copy in `SENTINEL_CODEX_SPEC.md`; it is
  now an optional Wrangler secret. Key was dead config (`src/openfda.ts` reader is
  unimported; live path calls OpenFDA keyless), so no behavior change. `.dev.vars`
  added to `.gitignore`. **Action required: rotate the key** — it was public on
  GitHub. History not scrubbed (rotation supersedes).
- **stakeholder:** Closed a credential-exposure issue in the Sentinel API. No user
  impact; a follow-up key rotation is pending.
- **customer-facing:** _(none — internal security hygiene, no functional change.)_
