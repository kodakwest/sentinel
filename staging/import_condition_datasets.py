#!/usr/bin/env python3
"""Import staged Sentinel graph seed JSON into Cloudflare D1 with wrangler."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


STAGING_DIR = Path(__file__).resolve().parent
PROJECT_DIR = STAGING_DIR.parent
DATASETS = [
    STAGING_DIR / "doid_conditions.json",
    STAGING_DIR / "hpo_symptom_edges.json",
    STAGING_DIR / "drugcentral_indications.json",
    STAGING_DIR / "mondo_crossrefs.json",
]


def sql_quote(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def default_database_name() -> str:
    wrangler = PROJECT_DIR / "wrangler.toml"
    if not wrangler.exists():
        return "sentinel"
    match = re.search(r'^database_name\s*=\s*"([^"]+)"', wrangler.read_text(encoding="utf-8"), flags=re.MULTILINE)
    return match.group(1) if match else "sentinel"


def run_batch(database: str, statements: list[str], *, local: bool, dry_run: bool) -> None:
    if not statements:
        return
    command = "BEGIN TRANSACTION;\n" + "\n".join(statements) + "\nCOMMIT;"
    wrangler_args = ["wrangler", "d1", "execute", database, f"--command={command}"]
    wrangler_args.append("--local" if local else "--remote")
    if dry_run:
        print(f"DRY RUN: {' '.join(wrangler_args[:4])} --command=<{len(statements)} statements> {wrangler_args[-1]}")
        return
    subprocess.run(wrangler_args, cwd=PROJECT_DIR, check=True)


def entity_statement(entity: dict, source: str) -> str:
    return (
        "INSERT INTO graph_nodes (entity_type, name, properties, source) VALUES "
        f"({sql_quote(entity.get('type'))}, {sql_quote(entity.get('name'))}, "
        f"{sql_quote(json.dumps(entity.get('properties') or {}, sort_keys=True))}, {sql_quote(source)});"
    )


def edge_statement(edge: dict, source: str) -> str:
    weight = edge.get("weight", 1.0)
    return (
        "INSERT INTO graph_edges (source_node_id, target_node_id, relationship, weight, source) "
        f"SELECT source_id, target_id, {sql_quote(edge.get('relationship'))}, {sql_quote(weight)}, {sql_quote(source)} "
        "FROM (SELECT "
        "(SELECT id FROM graph_nodes WHERE lower(name) = lower("
        f"{sql_quote(edge.get('source'))}) ORDER BY id DESC LIMIT 1) AS source_id, "
        "(SELECT id FROM graph_nodes WHERE lower(name) = lower("
        f"{sql_quote(edge.get('target'))}) ORDER BY id DESC LIMIT 1) "
        "AS target_id) AS edge_ids "
        "WHERE source_id IS NOT NULL AND target_id IS NOT NULL;"
    )


def import_dataset(path: Path, database: str, *, local: bool, dry_run: bool, batch_size: int) -> tuple[int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    source = data.get("source") or path.stem
    entities = data.get("entities") or []
    edges = data.get("edges") or []

    for index in range(0, len(entities), batch_size):
        run_batch(database, [entity_statement(entity, source) for entity in entities[index:index + batch_size]], local=local, dry_run=dry_run)

    for index in range(0, len(edges), batch_size):
        run_batch(database, [edge_statement(edge, source) for edge in edges[index:index + batch_size]], local=local, dry_run=dry_run)

    print(f"{source}: inserted {len(entities)} entities and {len(edges)} edges from {path.name}")
    return len(entities), len(edges)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Sentinel condition graph datasets into D1.")
    parser.add_argument("--database", default=default_database_name(), help="D1 database name. Defaults to wrangler.toml database_name.")
    parser.add_argument("--remote", action="store_true", help="Use remote D1. Defaults to local D1.")
    parser.add_argument("--dry-run", action="store_true", help="Print batch summaries without running wrangler.")
    parser.add_argument("--batch-size", type=int, default=100, help="Statements per wrangler d1 execute call.")
    parser.add_argument("datasets", nargs="*", type=Path, default=DATASETS, help="JSON dataset paths to import.")
    args = parser.parse_args()

    total_entities = 0
    total_edges = 0
    for dataset in args.datasets:
        if not dataset.exists():
            print(f"skip missing dataset: {dataset}")
            continue
        entities, edges = import_dataset(dataset, args.database, local=not args.remote, dry_run=args.dry_run, batch_size=args.batch_size)
        total_entities += entities
        total_edges += edges

    print(f"total: {total_entities} entities, {total_edges} edges")


if __name__ == "__main__":
    main()
