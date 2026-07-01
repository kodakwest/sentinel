---
kind: decision_record
project: sentinel
date: 2026-07-01
status: evidenced
commits: [3562a3f, c239d60]
evidence: complete
audience: [reviewer, future-self, security]
release_note: false
tags: [security, git-history, decision]
---

# Decision: push clean fixes to main, skip git-history rewrite

## Context
The leaked OpenFDA key exists in every commit from `5ac3929` onward on `main`
and on `origin/jules-rebrand-moodboard-*`. The repo is on GitHub
(`kodakwest/sentinel`) and the leaked commits were already pushed
(`git rev-list --left-right --count origin/main...main` = 0/0 before the fix),
so the key must be treated as public.

## Options considered
1. **Skip scrub, rotate only** — rely on key rotation to void the old value.
2. **Scrub `main` + force-push** — `git filter-repo --replace-text` (not
   installed; needs `pip install git-filter-repo`), rewrite all SHAs, force-push.
3. **Scrub `main` + jules branch** — most thorough, most disruptive.
4. **Push fixes only** — fast-forward the two removal commits, no history rewrite.

## Decision
**Option 4 — push fixes only** (user choice via prompt on 2026-07-01).

## Rationale
- The key is already public on GitHub; **rotation** (a user action) is what
  actually remediates it, and once rotated the historical value is worthless.
- History rewrite is hard-to-reverse and outward-facing: it changes every commit
  SHA, requires force-push, and breaks the `jules-rebrand-moodboard` branch base
  and any clones/forks/PRs. Marginal security value after rotation is low.
- `git-filter-repo` is not installed, adding an install step for low payoff.

## Consequence
Historical commits still contain the key value. This is acceptable **only
because the key is being rotated**. If rotation does not happen, revisit and run
Option 2/3. Evidence of the push: `4c745ed..c239d60  main -> main`.
