#!/usr/bin/env python3
"""Parse staged ontology/annotation files into Sentinel graph seed JSON."""

from __future__ import annotations

import csv
import json
import os
import re
from collections import defaultdict
from pathlib import Path


STAGING_DIR = Path(__file__).resolve().parent


def parse_obo_terms(path: Path) -> list[dict[str, list[str]]]:
    terms: list[dict[str, list[str]]] = []
    current: dict[str, list[str]] | None = None
    in_term = False

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            if line == "[Term]":
                if current and "id" in current and "name" in current:
                    terms.append(current)
                current = defaultdict(list)
                in_term = True
                continue
            if line.startswith("[") and line != "[Term]":
                if current and "id" in current and "name" in current:
                    terms.append(current)
                current = None
                in_term = False
                continue
            if not in_term or current is None or not line or ": " not in line:
                continue
            tag, value = line.split(": ", 1)
            current[tag].append(value)

    if current and "id" in current and "name" in current:
        terms.append(current)
    return [dict(term) for term in terms]


def synonym_value(line: str) -> str | None:
    match = re.match(r'"((?:[^"\\]|\\.)*)"', line)
    if not match:
        return None
    return match.group(1).replace(r"\"", '"')


def is_a_id(line: str) -> str:
    return line.split(" ! ", 1)[0].strip()


def xref_parts(lines: list[str]) -> dict[str, list[str]]:
    values: dict[str, set[str]] = {"icd10": set(), "omim": set(), "snomed": set()}
    for line in lines:
        token = line.split()[0]
        if token.startswith(("ICD10:", "ICD10CM:")):
            values["icd10"].add(token.split(":", 1)[1])
        elif token.startswith("OMIM:"):
            values["omim"].add(token.split(":", 1)[1])
        elif token.startswith(("SNOMEDCT_US_", "SNOMEDCT:")):
            values["snomed"].add(token.rsplit(":", 1)[-1])
    return {key: sorted(items) for key, items in values.items()}


def add_entity(entities_by_key: dict[tuple[str, str], dict], entity_type: str, name: str, properties: dict) -> None:
    clean_name = " ".join(name.split())
    if not clean_name:
        return
    key = (entity_type, clean_name.lower())
    if key not in entities_by_key:
        entities_by_key[key] = {"type": entity_type, "name": clean_name, "properties": properties}
        return
    existing = entities_by_key[key]["properties"]
    for prop, value in properties.items():
        if isinstance(value, list):
            merged = set(existing.get(prop) or [])
            merged.update(value)
            existing[prop] = sorted(merged)
        elif existing.get(prop) in (None, "", []):
            existing[prop] = value


def add_edge(edges_by_key: dict[tuple[str, str, str], dict], source: str, target: str, relationship: str, weight: float) -> None:
    source_name = " ".join(source.split())
    target_name = " ".join(target.split())
    if not source_name or not target_name:
        return
    key = (source_name.lower(), target_name.lower(), relationship)
    current = edges_by_key.get(key)
    if current is None or weight > current["weight"]:
        edges_by_key[key] = {
            "source": source_name,
            "target": target_name,
            "relationship": relationship,
            "weight": weight,
        }


def extract_doid_symptoms(def_lines: list[str]) -> list[str]:
    symptoms: list[str] = []
    for line in def_lines:
        text_match = re.match(r'"(.+?)"', line)
        if not text_match:
            continue
        text = text_match.group(1)
        for match in re.finditer(r"has\s*_?symptom\s+([^.,;]+)", text, flags=re.IGNORECASE):
            symptom = re.sub(r"^(and|or)\s+", "", match.group(1).strip(), flags=re.IGNORECASE)
            symptom = re.sub(r"\s+(and|or)$", "", symptom, flags=re.IGNORECASE)
            if symptom:
                symptoms.append(symptom)
    return symptoms


def write_json(path: Path, source: str, entities_by_key: dict, edges_by_key: dict) -> dict[str, int | str]:
    data = {
        "source": source,
        "entities": sorted(entities_by_key.values(), key=lambda item: (item["type"], item["name"].lower())),
        "edges": sorted(edges_by_key.values(), key=lambda item: (item["relationship"], item["source"].lower(), item["target"].lower())),
    }
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {"path": str(path), "entities": len(data["entities"]), "edges": len(data["edges"])}


def build_doid() -> dict[str, int | str]:
    terms = [term for term in parse_obo_terms(STAGING_DIR / "doid.obo") if "is_obsolete" not in term]
    by_id = {term["id"][0]: term for term in terms}
    entities: dict[tuple[str, str], dict] = {}
    edges: dict[tuple[str, str, str], dict] = {}

    for term in terms:
        name = term["name"][0]
        xrefs = xref_parts(term.get("xref", []))
        add_entity(entities, "condition", name, {
            "doid_id": term["id"][0],
            "icd10": xrefs["icd10"],
            "omim": xrefs["omim"],
            "snomed": xrefs["snomed"],
            "synonyms": sorted(filter(None, (synonym_value(item) for item in term.get("synonym", [])))),
        })

    for term in terms:
        child_name = term["name"][0]
        for parent_line in term.get("is_a", []):
            parent = by_id.get(is_a_id(parent_line))
            if parent:
                add_edge(edges, parent["name"][0], child_name, "is_a", 1.0)
        for symptom in extract_doid_symptoms(term.get("def", [])):
            add_entity(entities, "symptom", symptom, {"hpo_id": None, "doid_id": None})
            add_edge(edges, child_name, symptom, "has_symptom", 0.8)

    return write_json(STAGING_DIR / "doid_conditions.json", "doid", entities, edges)


def hpo_id_to_name() -> dict[str, str]:
    mapping: dict[str, str] = {}
    hp_path = STAGING_DIR / "hp.obo"
    if not hp_path.exists():
        return mapping
    for term in parse_obo_terms(hp_path):
        if "is_obsolete" not in term:
            mapping[term["id"][0]] = term["name"][0]
    return mapping


def frequency_weight(value: str) -> float:
    value = value.strip()
    mapped = {
        "HP:0040281": 1.0,
        "HP:0040282": 0.9,
        "HP:0040283": 0.7,
        "HP:0040284": 0.4,
        "HP:0040285": 0.1,
    }
    if value in mapped:
        return mapped[value]
    if re.fullmatch(r"\d+/\d+", value):
        numerator, denominator = (int(part) for part in value.split("/", 1))
        if denominator:
            return round(max(0.1, min(1.0, numerator / denominator)), 3)
    if value.endswith("%"):
        try:
            return round(max(0.1, min(1.0, float(value.rstrip("%")) / 100)), 3)
        except ValueError:
            pass
    return 0.7


def build_hpo() -> dict[str, int | str]:
    hp_names = hpo_id_to_name()
    entities: dict[tuple[str, str], dict] = {}
    edges: dict[tuple[str, str, str], dict] = {}
    path = STAGING_DIR / "phenotype.hpoa"

    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.reader((line for line in handle if not line.startswith("#")), delimiter="\t")
        header = next(reader, None)
        if not header:
            return write_json(STAGING_DIR / "hpo_symptom_edges.json", "hpo", entities, edges)
        index = {name: i for i, name in enumerate(header)}
        for row in reader:
            if len(row) < len(header):
                continue
            disease_name = row[index.get("disease_name", 1)].strip()
            hpo_id = row[index.get("hpo_id", 3)].strip()
            qualifier = row[index.get("qualifier", 2)].strip()
            if not disease_name or not hpo_id or qualifier.upper() == "NOT":
                continue
            db_id = row[index.get("database_id", 0)].strip()
            frequency = row[index.get("frequency", 7)].strip()
            symptom_name = hp_names.get(hpo_id, hpo_id)
            add_entity(entities, "condition", disease_name, {"source_id": db_id, "synonyms": []})
            add_entity(entities, "symptom", symptom_name, {"hpo_id": hpo_id, "doid_id": None})
            add_edge(edges, disease_name, symptom_name, "has_symptom", frequency_weight(frequency))

    return write_json(STAGING_DIR / "hpo_symptom_edges.json", "hpo", entities, edges)


def build_mondo() -> dict[str, int | str]:
    path = STAGING_DIR / "mondo.obo"
    entities: dict[tuple[str, str], dict] = {}
    edges: dict[tuple[str, str, str], dict] = {}
    if not path.exists() or path.read_text(encoding="utf-8", errors="ignore").lstrip().startswith("<!DOCTYPE html>"):
        return write_json(STAGING_DIR / "mondo_crossrefs.json", "mondo", entities, edges)

    terms = [term for term in parse_obo_terms(path) if "is_obsolete" not in term]
    by_id = {term["id"][0]: term for term in terms}
    for term in terms:
        xrefs = xref_parts(term.get("xref", []))
        doid = sorted({line.split()[0].split(":", 1)[1] for line in term.get("xref", []) if line.startswith("DOID:")})
        add_entity(entities, "condition", term["name"][0], {
            "mondo_id": term["id"][0],
            "doid": doid,
            "icd10": xrefs["icd10"],
            "omim": xrefs["omim"],
            "snomed": xrefs["snomed"],
            "synonyms": sorted(filter(None, (synonym_value(item) for item in term.get("synonym", [])))),
        })
    for term in terms:
        for parent_line in term.get("is_a", []):
            parent = by_id.get(is_a_id(parent_line))
            if parent:
                add_edge(edges, parent["name"][0], term["name"][0], "is_a", 1.0)
    return write_json(STAGING_DIR / "mondo_crossrefs.json", "mondo", entities, edges)


def build_drugcentral_placeholder() -> dict[str, int | str]:
    data = {
        "source": "drugcentral",
        "entities": [],
        "edges": [],
        "issues": [
            "The legacy indication TSV URL returned 404.",
            "The current DrugCentral download page exposes /ActiveDownload, but that response was HTML in this environment.",
            "Public unmtid-dbs.net indexes exposed target-interaction TSVs and older large PostgreSQL dumps, but no lightweight indication/contraindication TSV.",
        ],
    }
    path = STAGING_DIR / "drugcentral_indications.json"
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {"path": str(path), "entities": 0, "edges": 0}


def main() -> None:
    summaries = {
        "doid": build_doid(),
        "hpo": build_hpo(),
        "drugcentral": build_drugcentral_placeholder(),
        "mondo": build_mondo(),
    }
    print(json.dumps(summaries, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
