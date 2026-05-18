---
title: Sentinel Architecture
artifact_type: Architecture_Document
domain: Pharmacology; System Design; Cloudflare Workers
systems: Cloudflare Workers; D1; Workers AI; AI Search; React; OpenFDA; DailyMed
primary_entities: Sentinel; Nurse Clippy; Drug Dossier; AI Search; Condition Graph; Auth System
last_updated: 2026-05-18
---

# Sentinel Architecture

> Drug reference for nurses — powered by FDA data, AI summaries, and a growing condition graph.

## System Overview

Sentinel is a Cloudflare Workers-based application that ingests pharmaceutical data from FDA/DailyMed, enriches it with AI-generated nurse-friendly summaries, and surfaces it through a lightweight React SPA. A condition graph (75K+ conditions from DOID/HPO/MONDO) enables cross-linking between drugs and conditions.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Delivery (React SPA)                     │
│  Search → Drug Dossier → Condition Deep-Dive → Cheat Sheet  │
│                       Nurse Clippy (AI)                      │
├─────────────────────────────────────────────────────────────┤
│                    API Layer (Workers)                       │
│  /api/drugs/*  /api/conditions/*  /api/explain  /api/ask    │
│              /api/auth/*  /api/admin/*  /api/ingest          │
├─────────────────────────────────────────────────────────────┤
│                   Intelligence (Workers AI)                  │
│          llama-4-scout: FDA remap → nurse summaries          │
│          Graph entity extraction from label text             │
│          nurse-clippy AI Search: pharmacology RAG            │
├─────────────────────────────────────────────────────────────┤
│                       Data Layer (D1)                        │
│  drugs ─ conditions ─ graph_nodes ─ graph_edges ─ xref      │
│     explain_cache ─ qa_log (query/response farming)         │
├─────────────────────────────────────────────────────────────┤
│                  Data Sources (External)                     │
│  OpenFDA ─ DailyMed ─ RxNorm ─ DOID/HPO/MONDO               │
│           AI Sandbox Vault (curated graph)                   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Drug Lookup (Lazy Hydration)
```
User searches drug → Workers checks D1
  ├─ Found + enriched → return cached dossier
  ├─ Found + stale → return cached + ctx.waitUntil(enrichDrugFromFda)
  └─ Not found → assembleDrug (DailyMed) → save → return + ctx.waitUntil(enrich)
```

### Enrichment Pipeline
```
Raw drug in DB → needsFdaEnrichment() → TRUE
  → resolveRxNorm() → get FDA label via OpenFDA
  → remapFdaWithAi() [llama-4-scout]
     ├─ Success → nurse-friendly summaries in all fields
     └─ Fallback → direct map from FDA sections
  → fetchDailymedImages() → pill photos
  → upsertDrug() → save enriched record
  → storeAiGraph() → extract entities/edges to graph
```

### Condition Pipeline
```
DOID/HPO/MONDO ontologies → download → parse → merge
  → Stage as SQL → import to D1
  → conditions table (75K rows with symptoms, cross-refs)
  → graph_nodes/graph_edges (hierarchy + symptom edges)
  → cron: weekly check for updates
```

### Auth Flow
```
User enters email → POST /api/auth/login
  → rate-limit by email + IP
  → store SHA-256 token hash in auth_tokens
  → send MailChannels email (SendEmail fallback)
  → GET /api/auth/login?token=...
  → atomically consume token → set __Host-session → redirect
```

## Key Components

### Frontend (React SPA)
- **LoginView** (`login.tsx`): Magic-link login screen with DoseAtlas dark theme, email capture, sent/error states, and Nurse Clippy tag
- **SearchView**: Drug search + class browsing + condition results
- **DrugDossierView**: Full drug profile with nurse-friendly sections
- **ConditionView**: Condition deep-dive with symptoms, treatments, related conditions
- **AssistantPanel**: "Nurse Clippy" AI chat with markdown rendering, copy/save, dive-deeper mode, saved insights
- **ExplainButton**: `?` button on any term → AI explanation
- **CheatSheetView**: Quick-reference drug card

### Backend (Cloudflare Workers)
- `index.ts` — Router + handlers for all endpoints
- `auth.ts` — Magic-link request, token consumption, signed session cookies, auth checks
- `bootstrap.ts` — Runtime D1 bootstrap for `rate_limits` and `auth_tokens`
- `utils.ts` — Shared hashing, client IP, CORS, redirect sanitization, and base64url helpers
- `db.ts` — D1 queries: search, CRUD, graph operations
- `fda.ts` — FDA label fetching, AI remap, enrichment pipeline
- `ai.ts` — AI utility (extract JSON from model output)
- `dailymed.ts` — DailyMed SPL parsing + image scraping
- `cleaner.ts` — FDA text cleaning/normalization
- `ingest.ts` — Knowledge base import pipeline

### Data Model

**drugs** — Core drug records with all clinical fields
- name, generic_name, drug_class, rxcui, brand_names
- indications, contraindications, black_box_warnings
- side_effects, interactions, monitoring
- administration, pregnancy_category
- images, label_raw, source, enriched_at, assembled_at

**conditions** — Condition records from ontology merge
- name, description (with DOID/ICD-10/OMIM cross-refs)
- symptoms (top 50 HPO-mapped per condition)
- treatments, related_conditions

**graph_nodes / graph_edges** — Generic graph for ontology hierarchy + entity relationships
- entity_type: condition, symptom, drug, drug_class, lab, warning
- relationship: is_a, has_symptom, treats, contraindicated_with, may_cause, interacts_with

**drug_condition_xref** — Direct drug↔condition links

**auth_tokens** — Magic-link token records
- token_hash, email, purpose
- issued_at, expires_at, consumed_at
- redirect_url

**rate_limits** — Request buckets for auth and API throttling
- bucket_key, count, window_start

### Auth System

Sentinel gates protected APIs and the main clinical assistant experience with passwordless magic-link auth. `/api/auth/login` accepts an email address, rate-limits by IP and email, stores only a SHA-256 token hash, and sends a 15-minute link. MailChannels is the primary email provider; the Cloudflare SendEmail binding is used as a fallback when available.

Magic-link redemption is atomic: `auth.ts` updates a token only when it is unconsumed and unexpired, then returns the associated email. Successful redemption creates a 24-hour HMAC-signed `__Host-session` cookie. `/api/auth/me` validates the session for the frontend, and `/api/auth/logout` clears the cookie.

`SESSION_SECRET` is required as a Wrangler secret and is intentionally not stored in `wrangler.toml` vars. `AUTH_EMAIL_FROM` is `no-reply@logos-core.com`.

## Admin & Operations

| Endpoint | Purpose |
|---|---|
| `POST /api/explain` | AI term explanation (quick or deep mode) |
| `POST /api/ask` | Full Q&A with D1 + AI Search RAG |
| `POST /api/auth/login` | Request a magic-link email |
| `GET /api/auth/login` | Consume a magic-link token and set the session cookie |
| `POST /api/auth/logout` | Clear the session cookie |
| `GET /api/auth/me` | Return current authenticated user email |
| `POST /api/admin/backfill` | Batch enrich all drugs from FDA |
| `POST /api/admin/populate-all` | Rebuild conditions from graph |
| `POST /api/admin/push-graph` | Import graph seed data |
| `POST /api/admin/update-drug` | Direct drug record update |
| `POST /api/admin/refresh-drug/:name` | Mark single drug as stale for re-enrich |
| `POST /api/admin/refresh-batch` | Batch mark drugs as stale |
| `GET /api/admin/qa-log` | View logged Q&A pairs |

### Automation
- **condition-data-pipeline** (cron, Mondays 6AM): Checks DOID/HPO/MONDO for updates, re-imports changed ontologies
- **On-load enrichment**: New/refreshed drugs enrich automatically on first dossier view

## Refresh & Stale Logic

`needsFdaEnrichment(drug)` determines if a drug needs AI re-enrichment:
1. `enriched_at === "STALE"` → force refresh (set via admin)
2. No `enriched_at` and data incomplete → first-time enrichment
3. `enriched_at` > 30 days old → time-based refresh
4. Recent enrichment → skip

## Security

- Admin endpoints protected by `X-Admin-Key` header / `ADMIN_SECRET` env var
- Protected clinical assistant APIs require auth; public read-only drug/condition/graph APIs remain available
- Session cookies use `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- Sessions are HMAC-SHA-256 signed with `SESSION_SECRET` and expire after 24 hours
- Magic-link tokens are stored as SHA-256 hashes, expire after 15 minutes, and are atomically consumed to prevent replay
- Redirect targets are sanitized to same-origin relative paths to prevent open redirects
- Auth requests are rate-limited by email and client IP; general API requests use shared hourly buckets
- User-facing login failures use generic messages to avoid token state disclosure
- Minimal PII stored — auth stores email addresses for sessions/tokens and clinical reference data contains no patient records
- CORS restricted to app domain

## Future State

- DrugCentral indication/contraindication data (stale URL, TBD)
- Symptom→condition search
- Condition hierarchy browser (tree navigation)
- PDF ingest → automatic graph extraction → enrichment trigger
- Swap toggle: raw FDA text ↔ nurse-friendly summary in UI

## Design Decisions

### Non-blocking D1 Schema Checks
`ensureDrugSchema()` uses `ctx.waitUntil()` instead of `await` to prevent D1 cold start from blocking the first request. The schema check runs in the background while the response is already being processed. This is the recommended pattern for any D1 startup task in Workers.

### AI Search for Pharmacology RAG
The `nurse-clippy` AI Search instance holds 12 pharmacology documents (214 graph entities, 168 edges) from ATI Engage and F.A. Davis textbooks. This provides grounded, textbook-backed answers alongside structured D1 drug data. The embedding model is `@cf/qwen/qwen3-embedding-0.6b` with reranking enabled.

### Lazy Drug Hydration
Drugs are enriched from FDA data on first view, not upfront. This avoids batch-processing 117+ drugs during deployment. The `needsFdaEnrichment()` function determines staleness based on enrichment age or explicit STALE flag.

### QA Logging for Dataset Farming
Every assistant interaction is logged to `qa_log` for building a real clinical Q&A dataset. This is used for future fine-tuning, analytics, and debugging.

## Entity Relationships

- Sentinel -> runs_on -> Cloudflare Workers
- Sentinel -> stores_data_in -> D1
- Sentinel -> uses -> Workers AI
- Sentinel -> uses -> AI Search
- Sentinel -> imports_data_from -> OpenFDA
- Sentinel -> imports_data_from -> DailyMed
- Nurse Clippy -> assists -> Registered Nurses
- Auth System -> protects -> Clinical Assistant APIs
- Auth System -> stores_tokens_in -> `auth_tokens`
- Auth System -> limits_requests_with -> `rate_limits`
- Auth System -> sends_magic_links_via -> MailChannels
- Session Cookie -> signed_with -> `SESSION_SECRET`
