---
title: DoseAtlas — Medication Knowledge Map for Nurses
artifact_type: Project_README
source_context: Sentinel project overview updated after auth refactor
domain: Pharmacology; Nursing; Cloudflare Workers
systems: Cloudflare Workers; D1; Workers AI; AI Search; Vite; React; MailChannels
primary_entities: DoseAtlas; Sentinel; Nurse Clippy; Drug Database; AI Search; Auth System
last_updated: 2026-05-18
---

# DoseAtlas — Medication Knowledge Map for Nurses

> **Tagline:** Medication knowledge mapped for nurses.
> **Description:** DoseAtlas turns your nursing study guides, drug labels, and clinical documents into a medication knowledge map — with Nurse Clippy as your guide.
> **Stack:** Cloudflare Workers + D1 + Workers AI + AI Search + Vite + React 19 + TypeScript

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                 React SPA (Vite + React 19)                │
│  Search → Drug Dossier → Condition Deep-Dive → Cheat Sheet │
│              Assistant Panel (Nurse Clippy)                │
├────────────────────────────────────────────────────────────┤
│              API Layer (Cloudflare Workers)                 │
│  /api/drugs/*  /api/conditions/*  /api/explain  /api/ask   │
│              /api/auth/*  /api/admin/*                      │
├────────────────────────────────────────────────────────────┤
│         Intelligence (Workers AI + AI Search)               │
│  llama-4-scout: FDA remap → nurse summaries                │
│  nurse-clippy AI Search: pharmacology RAG (12 docs, 115+   │
│    vectors — ATI + F.A. Davis textbooks)                    │
├────────────────────────────────────────────────────────────┤
│              Data Layer (D1 + External APIs)                │
│  drugs ─ conditions ─ graph_nodes ─ graph_edges ─ xref     │
│  explain_cache ─ qa_log (farming dataset)                  │
│  OpenFDA ─ DailyMed ─ RxNorm ─ AI Sandbox Vault            │
└────────────────────────────────────────────────────────────┘
```

## Setup

```bash
npm install
npm run build
```

## Required Secrets

Set `SESSION_SECRET` as a Wrangler secret before deploying. It must be at least 16 characters; the Worker fails hard at runtime if it is missing or too short.

```bash
wrangler secret put SESSION_SECRET
```

## Local Development

Frontend only:
```bash
npm run dev
```

Worker with static assets after a build:
```bash
npm run build
wrangler dev
```

Apply the D1 schema locally:
```bash
npm run db:migrate:local
```

## Deploy

1. Create the D1 database in Cloudflare and replace `database_id` in `wrangler.toml`.
2. Set required secrets: `wrangler secret put SESSION_SECRET`
3. Deploy: `npm run deploy`

`npm run deploy` builds, applies remote D1 migrations, then deploys the Worker. Runtime startup also self-heals required system tables, including `rate_limits` and `auth_tokens`.

## API

### Auth
- `POST /api/auth/login` — Request a magic-link email. Body: `{ email, redirectUrl? }`.
- `GET /api/auth/login?token=...` — Consume a magic-link token, set the session cookie, and redirect.
- `POST /api/auth/logout` — Clear the session cookie.
- `GET /api/auth/me` — Return `{ email }` for the current session or `401`.

### Drug Search & Reference
- `GET /api/drugs/search?q=digoxin&limit=20` — Keyword search across drug names, generic names, brand names
- `GET /api/drugs/:id` — Full drug dossier (assembles on cache miss from DailyMed + FDA)
- `GET /api/drugs/classes` — Drug class list with counts
- `GET /api/drugs/by-class/:className` — Drugs in a class
- `GET /api/conditions/:id` — Condition deep-dive

### AI Assistant (Nurse Clippy)
- `POST /api/explain` — Explain a clinical term. Body: `{ term, drug?, context?, mode? }`. Mode: "quick" (default, 2-5 bullets) or "deep" (comprehensive clinical review with Assessment → Intervention → Monitoring sections).
- `POST /api/ask` — Full Q&A with D1 + AI Search RAG. Body: `{ query, drug?, context?, mode? }`.

### Graph
- `GET /api/graph/nodes?type=drug` — Graph nodes filtered by type
- `GET /api/graph/edges?node_id=1` — Graph edges for a node

### Admin (requires X-Admin-Key header)
- `POST /api/admin/populate-all` — Rebuild drugs/conditions from graph
- `POST /api/admin/push-graph` — Import graph seed data
- `POST /api/admin/refresh-drug/:name` — Mark drug as stale for re-enrich
- `POST /api/admin/refresh-batch` — Batch mark drugs as stale
- `POST /api/admin/backfill` — Batch enrich all drugs from FDA
- `POST /api/admin/update-drug` — Direct drug record update
- `GET /api/admin/qa-log?limit=20&drug=vancomycin` — View logged Q&A pairs

## Key Design Patterns

### Lazy Drug Hydration
Drugs enrich on-demand: first search returns assembled data, then `ctx.waitUntil()` enriches from FDA in the background. Subsequent views get the full dossier.

### Non-blocking Schema Checks
`ensureDrugSchema()` runs via `ctx.waitUntil()` at the start of every request — never `await`-ed. This prevents D1 cold start from blocking the response. This pattern is used throughout the codebase: any D1 startup task that isn't required for the current request goes in `ctx.waitUntil()`.

### Nurse Clippy RAG
The AI assistant has two data sources:
1. **D1 drug database** — structured records with indications, contraindications, monitoring, interactions
2. **AI Search (nurse-clippy)** — vector RAG on 12 pharmacology documents (ATI Engage + F.A. Davis textbooks, 115+ vectors)
Both are combined per-query for grounded, textbook-backed answers.

### QA Farming
Every `/api/explain` and `/api/ask` call is logged to the `qa_log` D1 table with full query, context, response, and metadata. This builds a dataset of real clinical Q&A for future fine-tuning.

## Seed Data

```bash
python3 populate_drugs.py --base-url http://127.0.0.1:8787
```

## Entity Relationships

- Sentinel -> runs_on -> Cloudflare Workers
- Sentinel -> stores_data_in -> D1
- Sentinel -> uses -> Workers AI
- Sentinel -> uses -> AI Search
- Nurse Clippy -> assists -> Registered Nurses
- Auth System -> stores_tokens_in -> auth_tokens
- Auth System -> limits_requests_with -> rate_limits
