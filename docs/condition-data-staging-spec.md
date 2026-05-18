# Condition Dataset Staging — Codex Spec

## Objective
Download, parse, and stage condition relationship datasets for import into Sentinel's D1 graph. Do NOT run `wrangler d1 execute` against production — stage as local SQL/JSON files ready for ingestion after the current drug backfill completes.

## Context
- Project: `/mnt/s/Projects/sentinel`
- D1 DB: `sentinel` (Cloudflare D1)
- Graph tables: `graph_nodes` (entity_type, name, properties), `graph_edges` (source_node_id, target_node_id, relationship, weight)
- Condition table: `conditions` (name, description, symptoms, treatments, related_conditions)
- Junction: `drug_condition_xref` (drug_id, condition_id, relationship)
- Seed patterns exist in `seed_d1.py`, `seed_curated.py`, `seed_all_batches.py` — reference these for syntax convention

## Priority Datasets (in order)

### 1. Disease Ontology (DO) — condition hierarchy
- **URL**: https://github.com/DiseaseOntology/HumanDiseaseOntology/releases/latest/download/doid.owl
  - Fallback: https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/src/ontology/doid.obo
- **Format**: OWL (or OBO)
- **Target output**: `staging/do_conditions.json` — array of {name, doid, synonyms, parent_doid, parent_name, is_a_chain}
- **Parsing**: Extract `Class` entries with `rdfs:label`, `oboInOwl:hasDbXref` (ICD-10, SNOMED, OMIM refs), and `rdfs:subClassOf` for hierarchy
- **Graph edges**: `relationship: "is_a"` for parent-child, entity_type: "condition"

### 2. HPO Annotations — condition→symptom
- **URL**: https://hpo.jax.org/data/annotations/phenotype.hpoa
  - Fallback: https://github.com/obophenotype/human-phenotype-ontology/releases/latest/download/phenotype.hpoa
- **Format**: HPOA (tab-separated, header starts with `#description: ...`)
- **Target output**: `staging/hpo_condition_symptoms.json` — array of {condition_id, condition_name, symptom_hpo_id, symptom_name, frequency, onset}
- **Parsing**: Columns: DB (OMIM/ORPHA), DB_Object_ID, DB_Name, Qualifier, HPO_ID, HPO_Term, Frequency, Onset
- **Graph edges**: `relationship: "has_symptom"` linking condition nodes to symptom nodes (entity_type: "symptom")
- **Note**: Frequency qualifier can become `weight` on the edge (e.g. HP:0040281=very_frequent → 0.9)

### 3. DrugCentral — drug-condition edges
- **URL**: https://drugcentral.org/export (or direct: https://unmtid-shinyapps.net/download/drugcentral.dump.20241001.sql.gz)
  - Alternative: Use CSV exports if SQL dump is too large
  - Indications CSV: https://drugcentral.org/export/drugcentral-indication.tsv
  - Contraindications: check drugcentral.org/downloads page
- **Format**: PostgreSQL dump or TSV
- **Target output**: `staging/drugcentral_indications.json` + `staging/drugcentral_contraindications.json`
- **Graph edges**: `relationship: "treats"` for indications, `relationship: "contraindicated_with"` for contraindications
- **Entity types**: drug nodes (entity_type: "drug"), condition nodes (entity_type: "condition")

### 4. MONDO — merged condition ontology (optional nice-to-have)
- **URL**: https://mondo.monarchinitiative.org/ — OWL download
- **Format**: OWL or OBO
- **Target output**: `staging/mondo_conditions.json`
- **Purpose**: Cross-reference mapping between DO, OMIM, Orphanet, ICD-10 for alias resolution

## Staging Output Format

All staged files go in `/mnt/s/Projects/sentinel/staging/`.

### Graph seed format (for ingestion via `insertGraphSeed`)

```json
{
  "source": "doid",
  "entities": [
    {"type": "condition", "name": "Diabetes mellitus", "properties": {"doid": "DOID:9351", "icd10": ["E10", "E11"], "synonyms": ["diabetes"]}}
  ],
  "edges": [
    {"source": "Diabetes mellitus", "target": "Type 2 diabetes mellitus", "relationship": "is_a", "weight": 1.0},
    {"source": "Diabetes mellitus", "target": "hyperglycemia", "relationship": "has_symptom", "weight": 0.8}
  ]
}
```

### Ingestion script
Create `staging/import_condition_datasets.py` that:
1. Reads each staged JSON file
2. Calls the D1 API (via wrangler or direct API) to seed via `insertGraphSeed`
3. Reports counts of entities and edges imported per source

## Steps
1. Create `staging/` directory
2. Download each dataset (curl, handle redirects)
3. Parse and transform to staging JSON
4. Write import script
5. Write a summary of what's staged and ready to ingest

## Constraints
- .edu/.gov sources only (HPO: .org is consortium domain, accepted)
- No .io, .dev, .net, .org except HPO (jax.org) and MONDO (monarchinitiative.org)
- Do NOT run `wrangler d1 execute` — stage only
- Dataset parsing via Python stdlib + rdflib if needed (pip install if missing)
- Keep downloads under 500MB total staged data
