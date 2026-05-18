# Sentinel — Codex Build Spec

**Full design context:** `/mnt/s/Projects/sentinel-build-spec.html` (open in browser)

Build order and complete spec at `/tmp/sentinel-codex-build.md`

## Key Instructions

1. Create project at `/mnt/s/Projects/sentinel/` (directory already exists, may have non-project files)
2. Manual scaffold — Vite + React 19 + TypeScript + custom CSS (no Tailwind)
3. Triage theme (teal/white clinical) with dark mode toggle via CSS custom properties
4. Worker with D1 + Workers AI + DailyMed + OpenFDA
5. D1 schema: drugs, conditions, drug_condition_xref, explain_cache, graph_nodes, graph_edges, chat_history
6. Worker endpoints: search, drug dossier, condition deep-dive, explain, ingest, graph
7. Frontend: Search → Drug Dossier → Condition Deep-Dive → Ingest → Assistant Panel
8. Every data field gets clickable "?" for AI explanation (Layer 1 + Layer 2)
9. Knowledge ingestion: POST /api/ingest extracts entities from uploaded text via Workers AI
10. Python seed script for populating initial drug data

## Credentials
- OpenFDA: `tIdrs6p8n8fGcuLSmqfhe1jpc5TiSG8040rs5fTy`
- CF Account: `66ed97b353e5ddb4255514b9ff042545`

## Success Criteria
- `npm run build` succeeds
- Worker + frontend both compile
- Worker serves frontend at root, API at /api/*
