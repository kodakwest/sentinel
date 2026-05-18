# Sentinel Condition Dataset Staging

Generated on 2026-05-14 in `/mnt/s/Projects/sentinel/staging`.

## Tooling

- `curl`: available at `/usr/bin/curl`
- `python3`: available at `/home/tsrwest/.hermes/hermes-agent/venv/bin/python3` (`Python 3.11.15`)
- `rdflib`: installed with `pip install rdflib` (`rdflib 7.6.0`)

## Downloaded Sources

| Dataset | Source URL | Local path | Size | Status |
| --- | --- | --- | ---: | --- |
| Disease Ontology | `https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/src/ontology/doid.obo` | `staging/doid.obo` | 6.8M | downloaded |
| HPO annotations | `https://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa` | `staging/phenotype.hpoa` | 34M | downloaded |
| HPO ontology names | `https://purl.obolibrary.org/obo/hp.obo` | `staging/hp.obo` | 11M | downloaded to resolve HP IDs to symptom names |
| MONDO | `https://purl.obolibrary.org/obo/mondo.obo` | `staging/mondo.obo` | 49M | downloaded |
| DrugCentral page | `https://drugcentral.org/download` | `staging/drugcentral_download.html` | 14K | downloaded for link inspection |
| DrugCentral `/ActiveDownload` response | `https://drugcentral.org/ActiveDownload` | `staging/drugcentral_active_download.html` | 9.1K | returned HTML, not a database dump |

The originally requested HPO URL (`https://hpo.jax.org/data/annotations/phenotype.hpoa`) returned the HPO web app HTML, so the parser uses the current PURL download. The originally requested MONDO URL returned a GitHub Pages 404, so the parser uses the current OBO PURL download.

## Staged Graph Files

| Output | Source | Entities | Edges | Notes |
| --- | --- | ---: | ---: | --- |
| `staging/doid_conditions.json` | `doid` | 12,722 | 18,430 | Conditions, synonyms, ICD-10/OMIM/SNOMED xrefs, `is_a` hierarchy, and `has_symptom` phrases extracted from DO definitions. |
| `staging/hpo_symptom_edges.json` | `hpo` | 24,088 | 275,728 | Condition-to-HPO symptom mappings. Frequency weights use the requested HP frequency codes, with numeric ratios converted to 0.1-1.0 weights. |
| `staging/drugcentral_indications.json` | `drugcentral` | 0 | 0 | Placeholder graph file with issues recorded; no lightweight indication/contraindication TSV was available from the inspected links. |
| `staging/mondo_crossrefs.json` | `mondo` | 53,233 | 43,772 | MONDO condition entities with DOID/ICD-10/OMIM/SNOMED xrefs and `is_a` hierarchy. |

## Scripts

- `staging/build_condition_datasets.py`: parses the staged OBO/HPOA files and writes the graph seed JSON files.
- `staging/import_condition_datasets.py`: imports staged JSON into D1 using `wrangler d1 execute`, batching entity inserts first and edge inserts second.

## Import When Ready

The project Wrangler config names the D1 database `sentinel-db`, while the task text says `sentinel`. The importer defaults to `sentinel-db` from `wrangler.toml`; override with `--database sentinel` if needed.

Dry run:

```bash
python3 staging/import_condition_datasets.py --dry-run
```

Local D1 import:

```bash
python3 staging/import_condition_datasets.py
```

Remote D1 import:

```bash
python3 staging/import_condition_datasets.py --remote
```

Optional smaller batches:

```bash
python3 staging/import_condition_datasets.py --batch-size 50 --remote
```

## DrugCentral Notes

- `https://unmtid-shinyapps.net/download/drugcentral-indication.tsv` returned 404.
- `https://drugcentral.org/download` currently links the full database through `/ActiveDownload`, but `/ActiveDownload` returned HTML in this environment.
- Public indexes under `https://unmtid-dbs.net/download/DrugCentral/` expose target-interaction TSV files and older large PostgreSQL dumps, but not the requested indication/contraindication TSV export.
- The older PostgreSQL dumps are approximately 1 GB compressed; they were not downloaded for this staging pass because the task asked to continue when downloads fail and prefer lightweight TSV exports.
