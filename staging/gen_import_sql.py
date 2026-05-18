#!/usr/bin/env python3
"""Generate consolidated SQL files from graph seed JSON for faster D1 import."""
from __future__ import annotations
import json, argparse
from pathlib import Path

STAGING_DIR = Path(__file__).resolve().parent

DATASETS = [
    STAGING_DIR / "doid_conditions.json",
    STAGING_DIR / "hpo_symptom_edges.json",
    STAGING_DIR / "mondo_crossrefs.json",
]

def sql_quote(v: object) -> str:
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def generate_sql(path: Path) -> None:
    data = json.loads(path.read_text("utf-8"))
    source = data.get("source", path.stem)
    entities = data.get("entities", [])
    edges = data.get("edges", [])
    
    base = path.with_suffix("")
    entity_sql = base.with_name(base.stem + "_entities.sql")
    edge_sql = base.with_name(base.stem + "_edges.sql")

    # Entity inserts (straight INSERT) — 20 per batch to stay under SQLite limits
    with open(entity_sql, "w") as f:
        f.write(f"-- Entities from {source}\n")
        for i in range(0, len(entities), 20):
            batch = entities[i:i+20]
            f.write("INSERT INTO graph_nodes (entity_type, name, properties, source) VALUES\n")
            rows = []
            for e in batch:
                props = json.dumps(e.get("properties") or {}, sort_keys=True)
                rows.append(
                    f"({sql_quote(e.get('type'))}, {sql_quote(e.get('name'))}, "
                    f"{sql_quote(props)}, {sql_quote(source)})"
                )
            f.write(",\n".join(rows))
            f.write(";\n")
    print(f"  {entity_sql.name}: {len(entities)} entities")

    # Edge inserts with subquery lookups — 20 per batch
    with open(edge_sql, "w") as f:
        f.write(f"-- Edges from {source} (entities must be inserted first)\n")
        for i in range(0, len(edges), 20):
            batch = edges[i:i+20]
            f.write("INSERT INTO graph_edges (source_node_id, target_node_id, relationship, weight, source) VALUES\n")
            rows = []
            for e in batch:
                weight = e.get("weight", 1.0)
                rows.append(
                    f"((SELECT id FROM graph_nodes WHERE lower(name) = lower({sql_quote(e.get('source'))})"
                    f" AND source = {sql_quote(source)} ORDER BY id DESC LIMIT 1), "
                    f"(SELECT id FROM graph_nodes WHERE lower(name) = lower({sql_quote(e.get('target'))})"
                    f" AND source = {sql_quote(source)} ORDER BY id DESC LIMIT 1), "
                    f"{sql_quote(e.get('relationship'))}, {weight}, {sql_quote(source)})"
                )
            f.write(",\n".join(rows))
            f.write(";\n")
    print(f"  {edge_sql.name}: {len(edges)} edges")

def main():
    for ds in DATASETS:
        if not ds.exists():
            print(f"Skipping {ds.name} (not found)")
            continue
        print(f"\n{ds.name}:")
        generate_sql(ds)

if __name__ == "__main__":
    main()
