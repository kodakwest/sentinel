---
title: Nurse Clippy — Full Integration Spec
artifact_type: Implementation_Spec
domain: Pharmacology; AI Assistant; Cloudflare Workers
systems: Cloudflare Workers; D1; Workers AI; AI Search; Sentinel
primary_entities: Nurse Clippy; Sentinel; AI Search; Drug Database
last_updated: 2026-05-14
---

# Nurse Clippy — Full Integration Spec

**Status:** Spec — ready for Codex
**Stack:** Cloudflare Workers + D1 + Workers AI + AI Search
**Project root:** `/mnt/s/Projects/sentinel/`
**Persona:** Nurse Clippy — clinical pharmacology assistant for registered nurses

---

## What We're Building

Nurse Clippy is a rebranded, upgraded drug information assistant that combines three data sources into one answer:

1. **Curated pharmacology knowledge** (ATI + F.A. Davis textbooks) → retrieved via AI Search vector RAG
2. **Structured drug database** (Sentinel D1 with 117+ drugs from graph ETL) → queried via SQL
3. **FDA label data** (OpenFDA + DailyMed + RXNorm) → fetched live or from cache

The existing `/api/explain` endpoint is the starting point. We're upgrading it to a full `/api/ask` endpoint with AI Search integration, a more confident system prompt, and proper branding.

---

## Files to Create/Modify

### 1. `wrangler.toml` — Add AI Search Binding

Add an AI Search binding for the `nurse-clippy` instance:

```toml
[[ai_search]]
binding = "SEARCH"
instance_name = "nurse-clippy"
```

### 2. `src/types.ts` — Add AskRequest type

```typescript
export interface AskRequest {
  query: string;          // Natural language question
  drug?: string;          // Optional drug name to narrow context
  context?: string;       // Optional clinical context
}

export interface SearchResult {
  text: string;
  score: number;
  item_key: string;
}
```

### 3. `src/ai.ts` — NEW system prompt, add `askNurseClippy()` function

Replace the existing `explainTerm` function with a new `askNurseClippy()` function that:
- Takes `AskRequest` + `DrugRecord | null` + `SearchResult[]` (from AI Search)
- Uses a refreshed, more confident system prompt (see below)
- Optionally keep `explainTerm` for backwards compatibility but route through the new prompt

### 4. `src/index.ts` — Add `/api/ask` endpoint

```
POST /api/ask
Body: { query: string, drug?: string, context?: string }

Logic:
1. If drug name provided → lookup in D1 (getDrugByIdOrName)
2. If drug found + needs FDA enrichment → fire ctx.waitUntil(enrichDrugFromFda)
3. Search AI Search for relevant context (query + drug name)
4. Build drug data context from D1 record
5. Call Workers AI with updated Nurse Clippy prompt
6. Return { answer, sources: { drug, search_results } }

Response:
{
  "answer": "...",
  "sources": {
    "drug": { name, source, enriched_at },
    "search_results": [{ item_key, score }]
  },
  "cached": false
}
```

### 5. `src/db.ts` — No changes needed (already has all query functions)

---

## New System Prompt — Nurse Clippy v2

The old prompt was cautious because the dataset was thin. Now with full ATI/F.A. Davis pharmacology + FDA data + AI Search RAG, she can be more confident:

```
You are Nurse Clippy, a clinical pharmacology assistant built for registered nurses. You combine three data sources:
  • Textbooks — ATI Engage Pharmacology + F.A. Davis (nursing-reviewed drug education content)
  • FDA Labels — OpenFDA and DailyMed official drug labeling data  
  • Drug Database — Structured drug records with indications, contraindications, interactions, monitoring

Personality: Direct, clinically precise, no fluff. You speak like an experienced nurse educator who's seen it all. You use plain clinical language, not academic jargon. Occasional dry clinical humor is acceptable when appropriate (e.g., "This is why we check lab values before rounds").

Answering:
- For drug-specific questions: Pull from the provided drug data + AI Search context. Be specific — name the drugs, conditions, and monitoring parameters.
- For general pharmacology: Use the textbook content + your training knowledge confidently.
- Only say "consult the official label" when the data genuinely doesn't have the answer — don't default to it.
- Format: 3-5 bullet points maximum. Clinical action items first. End with the data source.
- No need to badge every bullet with source icons unless comparing multiple sources.
- If the nurse asks about a drug not in the database, use the FDA integration lookup context if available, then suggest checking the official label.

Boundaries:
- Never invent specific warnings, interactions, or contraindications
- If the data is absent for a specific fact, say "I don't have that in my current data" — not "consult your facility guide"
- For critical safety information (black box warnings, life-threatening interactions), always flag with "⚠️ Critical:"

Output format: Plain text conversational answer. No phase headings, no protocol references.
```

---

## Dataset Seeding — Ensure Completeness

Before deploying, run a one-time seed of `nurse-clippy` with:

1. **Consolidated Pharmacology Reference** ✅ Already loaded
2. **ATI Antibacterials source deck** ✅ Already loaded  
3. **ATI Antifungals source deck** ✅ Already loaded
4. **ATI Antivirals source deck** ✅ Already loaded
5. **ATI Antiparasitics source deck** ✅ Already loaded
6. **ATI Dosage Calculations source deck** ✅ Already loaded
7. **F.A. Davis Regulations chapter** ✅ Already loaded
8. **F.A. Davis Patient Safety chapter** ✅ Already loaded
9. **F.A. Davis Basics of Pharmacology chapter** ✅ Already loaded
10. **Graph Entity data (214 nodes, 168 edges)** ✅ Already loaded
11. **Batch 2-6 pharmacology supplement data** ✅ Already loaded
12. **FDA Data Integration context** ✅ Already loaded
13. **Sentinel FDA Integration Plan** ✅ Already in Janet (cross-reference)

**Total: 12 documents loaded into nurse-clippy AI Search instance.**

---

## Build Order

| Step | Task | File(s) | Est. Time |
|------|------|---------|-----------|
| 1 | Add AI Search binding to wrangler.toml | wrangler.toml | 2min |
| 2 | Add AskRequest type | src/types.ts | 2min |
| 3 | Write new askNurseClippy() function | src/ai.ts | 15min |
| 4 | Add /api/ask route handler | src/index.ts | 15min |
| 5 | Test locally with wrangler dev | — | 10min |
| 6 | Deploy | — | 2min |

---

## Edge Cases & Notes

- **No drug match**: If no drug found in D1 or AI Search, fall back to Workers AI general pharmacology knowledge
- **FDA API down**: Graceful degradation — cached FDA data still works, new lookups skip enrichment
- **Long answers**: Cap at ~500 chars for quick-hit answers, offer to expand
- **Rate limiting**: AI Search has 60 req/min on public endpoint; Worker keeps it internal via binding
- **Cold start**: First request after deploy may be 3-5s; subsequent <1s
- **Cache**: /api/explain already has explain_cache table — reuse pattern for /api/ask

---

## Verification

```bash
# Test the API
curl -X POST https://sentinel-api.workers.dev/api/ask \
  -H "Content-Type: application/json" \
  -d '{"query":"What do I need to monitor when giving vancomycin?","drug":"vancomycin"}'

# Expected: Returns monitoring parameters (trough levels, renal function, infusion reactions)
# with source from both ATI textbook data + FDA label
```

## Learnable Pattern: Non-blocking D1 Startup Tasks

During implementation, we discovered that `ensureDrugSchema()` (a D1 PRAGMA + ALTER TABLE check) was running synchronously before every request. On cold start, this added 20-30s latency to searches.

**Fix:** Move to `ctx.waitUntil()`:
```typescript
// Before (blocks every request):
await ensureDrugSchema(env.DB);

// After (non-blocking):
ctx.waitUntil(ensureDrugSchema(env.DB).catch(() => {}));
```

**Rule:** Any D1 startup/maintenance task that isn't required for the current response should use `ctx.waitUntil()`. This prevents D1 cold start from cascading into user-facing latency.
