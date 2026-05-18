#!/usr/bin/env python3
"""
Fast condition data merger — generates consolidated SQL files for D1 import.
Usage: python3 staging/merge_condition_datasets.py [--dry-run]
"""
from __future__ import annotations
import json, re, subprocess, sys, argparse
from pathlib import Path
from collections import defaultdict

STAGING_DIR = Path(__file__).resolve().parent
PROJECT_DIR = STAGING_DIR.parent

def load_json(name: str) -> dict:
    path = STAGING_DIR / name
    if not path.exists():
        print(f"  WARN: {name} not found, skipping")
        return {"entities": [], "edges": []}
    return json.loads(path.read_text("utf-8"))

def normalize(name: str) -> str:
    return re.sub(r'\s+', ' ', name.strip().lower())

def sq(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def run_sql_file(path: Path, label: str, dry: bool = False) -> None:
    if dry:
        print(f"  [DRY] {label}: {path.name} ({path.stat().st_size:,} bytes)")
        return
    print(f"  Executing {label}...")
    r = subprocess.run(
        ["wrangler", "d1", "execute", "sentinel-db", "--remote", f"--file={path}"],
        cwd=PROJECT_DIR, capture_output=True, text=True, timeout=600
    )
    if r.returncode != 0:
        print(f"  ERR: {r.stderr[:500]}")
    else:
        # Extract summary from output
        for line in r.stdout.split('\n'):
            if 'Rows written' in line or 'success' in line.lower() and 'true' in line.lower():
                print(f"  {line.strip()}")
                break
        print(f"  OK ({len(r.stdout)} bytes response)")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    dry = args.dry_run

    print("Loading datasets...")
    doid = load_json("doid_conditions.json")
    hpo = load_json("hpo_symptom_edges.json")
    mondo = load_json("mondo_crossrefs.json")

    # ── Build unified condition index ──
    conditions: dict[str, dict] = defaultdict(lambda: {
        "canonical": "", "syns": set(),
        "doid_id": None, "icd10": set(), "omim": set(), "snomed": set(),
        "symptoms": {}, "parent": None, "children": set(),
    })

    # DOID entities
    for e in doid.get("entities", []):
        if e.get("type") != "condition": continue
        name = e.get("name", "")
        norm = normalize(name)
        props = e.get("properties", {})
        cx = conditions[norm]
        cx["canonical"] = name
        if props.get("doid_id"): cx["doid_id"] = props["doid_id"]
        for syn in props.get("synonyms", []):
            sn = normalize(syn)
            if sn: conditions[sn]["canonical"] = syn
        for code in props.get("icd10", []): cx["icd10"].add(code)
        for code in props.get("omim", []): cx["omim"].add(code)

    # DOID hierarchy
    parent_map: dict[str, str] = {}
    for e in doid.get("edges", []):
        if e.get("relationship") == "is_a":
            parent_map[normalize(e["target"])] = normalize(e["source"])

    # HPO symptoms
    for e in hpo.get("edges", []):
        if e.get("relationship") == "has_symptom":
            cn = normalize(e.get("source", ""))
            sym = e.get("target", "")
            w = e.get("weight", 0.5)
            if cn and sym:
                conditions[cn]["symptoms"][sym] = max(conditions[cn]["symptoms"].get(sym, 0), w)

    # MONDO cross-refs
    for e in mondo.get("entities", []):
        norm = normalize(e.get("name", ""))
        props = e.get("properties", {})
        cx = conditions[norm]
        cx["canonical"] = e.get("name", "")
        if not cx["doid_id"] and props.get("doid_id"): cx["doid_id"] = props["doid_id"]
        for code in props.get("icd10", []): cx["icd10"].add(code)
        for code in props.get("omim", []): cx["omim"].add(code)
        for code in props.get("snomed", []): cx["snomed"].add(code)

    print(f"Unique conditions (all sources): {len(conditions):,}")

    # ── Generate Phase 1 SQL: conditions table ──
    print("\n── Phase 1: conditions table ──")
    p1 = STAGING_DIR / "p1_conditions.sql"
    count = 0
    with open(p1, "w") as f:
        f.write("-- Phase 1: populate conditions table\n")
        for norm, cx in sorted(conditions.items()):
            if not cx["canonical"]: continue
            name = cx["canonical"]
            desc_parts = []
            if cx["doid_id"]: desc_parts.append(f"DOID: {cx['doid_id']}")
            if cx["icd10"]: desc_parts.append(f"ICD-10: {', '.join(sorted(cx['icd10']))}")
            if cx["omim"]: desc_parts.append(f"OMIM: {', '.join(sorted(cx['omim']))}")
            description = "; ".join(desc_parts) if desc_parts else None
            symptoms = sorted(cx["symptoms"].keys(), key=lambda s: -cx["symptoms"][s])[:50]
            f.write(
                f"INSERT OR IGNORE INTO conditions (name, description, symptoms, treatments, related_conditions, source) VALUES "
                f"({sq(name)}, {sq(description)}, {sq(json.dumps(symptoms))}, '[]', '[]', 'staged:condition-merge');\n"
            )
            count += 1
            # Update existing rows with symptom data where available
            if symptoms:
                f.write(
                    f"UPDATE conditions SET symptoms = {sq(json.dumps(symptoms))}, "
                    f"source = CASE WHEN source IS NULL THEN 'staged:condition-merge' ELSE source || '+staged' END "
                    f"WHERE lower(name) = lower({sq(name)}) AND source IS NULL;\n"
                )
    print(f"  Generated {p1.name}: {count:,} INSERT statements")

    # ── Generate Phase 2 SQL: hierarchy edges ──
    print("\n── Phase 2: ontology hierarchy ──")
    p2 = STAGING_DIR / "p2_hierarchy.sql"
    edge_count = 0
    with open(p2, "w") as f:
        f.write("-- Phase 2: ontology hierarchy edges\n")
        f.write("INSERT OR IGNORE INTO graph_nodes (entity_type, name, properties, source)\nSELECT 'condition', name, '{}', 'doid' FROM conditions WHERE source LIKE '%staged%';\n")
        for child_norm, parent_norm in parent_map.items():
            child_cx = conditions.get(child_norm)
            parent_cx = conditions.get(parent_norm)
            if not child_cx or not parent_cx or not child_cx["canonical"] or not parent_cx["canonical"]:
                continue
            f.write(
                f"INSERT OR IGNORE INTO graph_edges (source_node_id, target_node_id, relationship, weight, source)\n"
                f"VALUES ((SELECT id FROM graph_nodes WHERE lower(name) = lower({sq(parent_cx['canonical'])}) LIMIT 1),\n"
                f"        (SELECT id FROM graph_nodes WHERE lower(name) = lower({sq(child_cx['canonical'])}) LIMIT 1),\n"
                f"        'is_a', 1.0, 'doid');\n"
            )
            edge_count += 1
    print(f"  Generated {p2.name}: {edge_count:,} hierarchy edges")

    # ── Generate Phase 4 SQL: drug_condition_xref ──
    print("\n── Phase 4: drug_condition_xref ──")
    p4 = STAGING_DIR / "p4_xref.sql"
    with open(p4, "w") as f:
        f.write("-- Phase 4: drug-condition cross-reference\n")
        f.write("""INSERT OR IGNORE INTO drug_condition_xref (drug_id, condition_id, relationship)
SELECT d.id, c.id, 'treats'
FROM drugs d
JOIN conditions c ON lower(c.name) = lower(d.name)
   OR EXISTS (SELECT 1 FROM json_each(d.indications) ind WHERE lower(ind.value) = lower(c.name))
WHERE d.id IS NOT NULL AND c.id IS NOT NULL;
""")
    print(f"  Generated {p4.name}")

    print(f"\nSQL files generated. Sizes:")
    for f in [p1, p2, p4]:
        sz = f.stat().st_size
        print(f"  {f.name}: {sz:,} bytes")

    if dry:
        print("\nDRY RUN — no execution. Run without --dry-run to execute.")
        return

    # ── Execute ──
    print("\n── Executing Phase 1: conditions ──")
    run_sql_file(p1, "conditions", dry)

    print("\n── Executing Phase 2: hierarchy ──")
    run_sql_file(p2, "hierarchy", dry)

    print("\n── Executing Phase 3: HPO symptom edges ──")
    hpo_edge_file = STAGING_DIR / "hpo_symptom_edges_edges.sql"
    if hpo_edge_file.exists():
        run_sql_file(hpo_edge_file, "HPO symptom edges", dry)
    else:
        print("  SKIP: not found")

    print("\n── Executing Phase 4: drug-condition xref ──")
    run_sql_file(p4, "xref", dry)

    print("\nDone.")

if __name__ == "__main__":
    main()
