# Sentinel — Drug Reference for Nurses

> **Tagline:** The last line of defense deserves the first line of information.
> **Stack:** Cloudflare Workers + D1 + Workers AI + Pages (identical pattern to Bible AI Search)
> **Project root:** `S:\Projects\sentinel\` (mounts at `/mnt/s/Projects/sentinel/` in WSL)

---

## Why This Exists

Nurses are the **end of the line** for medication safety. The doctor prescribes, the pharmacist verifies, but the nurse **administers**. When a contraindication is missed — drug interaction, allergy, underlying condition — the nurse is legally responsible. No existing free app gives a nurse everything they need in **one view** with **cross-referenced deep-dives** and **inline AI explanations**.

## Architecture

```
┌──────────────────────────────┐
│  Frontend (React SPA)       │
│  - Search (home page)       │
│  - Drug Dossier view        │
│  - Condition Deep-Dive      │
│  - Inline AI "what's this?" │
│  - Journal / History        │
└──────────┬───────────────────┘
           │ fetch()
┌──────────▼───────────────────┐
│  Worker (sentinel-api)      │
│  GET  /api/drugs/search?q=  │
│  GET  /api/drugs/:id        │
│  GET  /api/conditions/:id   │
│  POST /api/explain          │
│  POST /api/journal/save     │
│  GET  /api/history          │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  Data Sources (on-demand)   │
│  ├── DailyMed / RxNorm API  │
│  ├── OpenFDA                │
│  ├── MedlinePlus            │
│  └── Workers AI (fallback)  │
└──────────────────────────────┘
```

## Build Order

### Step 1: Scaffold Project
- Create `/mnt/s/Projects/sentinel/` directory
- Vite + React + TypeScript setup (same as Bible AI Search)
- `wrangler.toml` with D1 + AI bindings
- `package.json`, `tsconfig.json`, `vite.config.ts`

### Step 2: D1 Schema

```sql
CREATE TABLE drugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,           -- Generic name (e.g., "digoxin")
  brand_names TEXT,                    -- JSON array of brand names
  drug_class TEXT,
  indications TEXT,                    -- JSON array of condition references
  contraindications TEXT,              -- JSON array
  black_box_warnings TEXT,
  side_effects TEXT,                   -- JSON array of "watch for" items
  interactions TEXT,                   -- JSON array of drug-drug, drug-food, drug-herb
  monitoring TEXT,                     -- JSON array (labs, vitals, EKG)
  allergies TEXT,                      -- JSON array (eggs, gelatin, latex, etc.)
  pregnancy_category TEXT,
  administration_notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  symptoms TEXT,
  treatments TEXT,                     -- JSON array of drug references (IDs)
  related_conditions TEXT,             -- JSON array
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE explain_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash TEXT UNIQUE NOT NULL,     -- Hash of question + context
  explanation TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_name TEXT,
  condition_name TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_drugs_name ON drugs(name);
CREATE INDEX idx_conditions_name ON conditions(name);
CREATE INDEX idx_explain_hash ON explain_cache(query_hash);
CREATE INDEX idx_journal_date ON journal(created_at);
```

### Step 3: Worker — Drug Endpoints

#### GET /api/drugs/search?q=digoxin
- Keyword search across `drugs.name` and `brand_names`
- Return: `{ results: [{ id, name, brand_names, drug_class, indications_summary }] }`

#### GET /api/drugs/:id
- Return full drug dossier
- On cache miss: assemble from DailyMed API
- Return: full drug object with all fields

#### PUT /api/drugs (admin/populate)
- Accept: `{ name, brand_names, drug_class, indications, ... }`
- Upsert into drugs table
- Used by data population script

### Step 4: Worker — Condition Endpoints

#### GET /api/conditions/:id
- Return: `{ name, description, symptoms, treatments, related_conditions }`
- On cache miss: assemble from MedlinePlus + NIH

#### GET /api/conditions/search?q=
- Keyword search across conditions

### Step 5: Worker — AI Explain Endpoint

#### POST /api/explain
```json
{ "question": "What is serotonin syndrome?", "context": "SSRI antidepressants" }
```
- Check explain_cache
- On miss: Workers AI (Llama 4) generates explanation
- Return: `{ explanation, cached: bool }`
- Cache aggressively (same Q + context = same answer)

### Step 6: Worker — Journal / History

#### POST /api/journal/save
```json
{ "drugName": "digoxin", "conditionName": "atrial fibrillation", "note": "Patient had..." }
```

#### GET /api/history?limit=50
- Return recent journal entries ordered by date desc

### Step 7: Frontend — Drug Dossier View

Full drug card showing:
- **Name** (generic + brand)
- **Drug Class** (linked)
- **Indications** — list of conditions as clickable links
- **Contraindications** — "Do not give if..."
- **Black Box Warnings** — highlighted
- **Side Effects to Monitor** — with severity indicators
- **Interactions** — drug-drug, drug-food, drug-herb
- **Monitoring Requirements** — labs, vitals before/during
- **Allergies** — eggs, gelatin, latex, etc.
- **Pregnancy / Lactation**
- **Administration Notes**
- Each section has a `?` icon for inline AI explanation

### Step 8: Frontend — Condition Deep-Dive

Condition page showing:
- **Description**
- **Signs & Symptoms**
- **Standard Treatment Protocols**
- **Linked Medications** (clickable → drug dossier)
- **Related Conditions**
- Inline `?` explanation support

### Step 9: Frontend — Inline AI Q&A

Any `?` icon opens a small popover:
- Text area: "What does this mean?"
- Submit → loading → explanation appears inline
- No full chat — just quick targeted answer

### Step 10: Frontend — Journal / History

- Sidebar or separate view
- Chronological list of searches with notes
- Each entry: drug name + condition + note + timestamp
- Click to re-open drug/condition

### Step 11: Data Population Script

A local Python script that:
1. Reads the ~200 most common hospital drugs from a curated list
2. For each drug, fetches FDA/DailyMed data
3. Extracts: indications, contraindications, side effects, interactions, monitoring, allergies
4. Upserts into the drugs table via the Worker API
5. Populates conditions from MedlinePlus

### Step 12: Styling

- Clean medical-themed dark UI (same palette as Bible AI Search)
- Mobile-first — nurses use phones on the floor
- High contrast for quick scanning
- Card-based layout
- Search focused (big search bar, autocomplete)

## Data Assembly Pattern

The key innovation is **on-demand assembly**:

```
Search → Worker checks D1 cache
       → On miss: Worker fans out to 2-3 external APIs
         ├── DailyMed / RxNorm → structured drug data
         ├── MedlinePlus → condition descriptions
         └── OpenFDA → adverse events
       → Aggregates into unified dossier
       → Caches in D1 (24h TTL for drugs, 7d for conditions)
       → Returns to user
```

This means no pre-built database exists. The Worker builds it on first request.

## MVP Data Set (Phase 1)

Top ~200 most-administered hospital medications covering:
- Cardiovascular (digoxin, amiodarone, lisinopril, metoprolol...)
- Antibiotics (vancomycin, ciprofloxacin, ceftriaxone...)
- Psychiatric (SSRIs, SNRIs, antipsychotics, benzodiazepines...)
- Pain management (morphine, fentanyl, hydromorphone...)
- Anticoagulants (heparin, warfarin, enoxaparin...)
- Vaccines (flu, varicella, MMR, COVID...)
- Common PRN meds (ondansetron, diphenhydramine, acetaminophen...)

## Differentiation

| Google/Existing Apps | Sentinel |
|---------------------|----------|
| Multiple searches needed | One search = full dossier |
| No cross-reference | Click any condition for deep-dive |
| No history tracking | Journal + search history |
| Ads, paywalls | Free |
| Generic results | Nurse-specific: monitoring, admin notes, legal weight |
| No inline AI | "What's this?" on any term |
| Fragmented sources | One assembled view |

## Files to Create

```
sentinel/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── src/
│   ├── index.ts               ← Worker router
│   ├── db.ts                  ← D1 queries
│   ├── assembler.ts           ← External API calls + aggregation
│   ├── ai.ts                  ← Workers AI (explanations)
│   ├── types.ts               ← Shared types
│   └── frontend/
│       ├── index.html
│       ├── app.tsx
│       ├── search.tsx
│       ├── drug-view.tsx
│       ├── condition-view.tsx
│       ├── explain-popover.tsx
│       ├── journal.tsx
│       └── style.css
├── schemas/
│   ├── 001_create_tables.sql
├── scripts/
│   └── populate_drugs.py      ← Data population from DailyMed
└── docs/
    └── API.md
```
