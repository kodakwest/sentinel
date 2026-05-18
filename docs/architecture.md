---
title: Sentinel Architecture
artifact_type: Architecture_Document
domain: Pharmacology; System Design; Cloudflare Workers
systems: Cloudflare Workers; D1; Workers AI; AI Search; React; OpenFDA; DailyMed
primary_entities: Sentinel; Nurse Clippy; Drug Dossier; AI Search; Condition Graph
last_updated: 2026-05-14
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
│                         /api/admin/*                         │
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

## Key Components

### Frontend (React SPA)
- **SearchView**: Drug search + class browsing + condition results
- **DrugDossierView**: Full drug profile with nurse-friendly sections
- **ConditionView**: Condition deep-dive with symptoms, treatments, related conditions
- **AssistantPanel**: "Nurse Clippy" AI chat with markdown rendering, copy/save, dive-deeper mode, saved insights
- **ExplainButton**: `?` button on any term → AI explanation
- **CheatSheetView**: Quick-reference drug card

### Backend (Cloudflare Workers)
- `index.ts` — Router + handlers for all endpoints
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

## Admin & Operations

| Endpoint | Purpose |
|---|---|
| `POST /api/explain` | AI term explanation (quick or deep mode) |
| `POST /api/ask` | Full Q&A with D1 + AI Search RAG |
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
- No PII stored — drug reference only
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
