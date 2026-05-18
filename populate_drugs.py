#!/usr/bin/env python3
"""Seed Sentinel with common floor medications through the Worker API."""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request


COMMON_DRUGS = [
    "digoxin",
    "furosemide",
    "metoprolol",
    "lisinopril",
    "amiodarone",
    "warfarin",
    "heparin",
    "insulin glargine",
    "insulin lispro",
    "albuterol",
    "ceftriaxone",
    "vancomycin",
    "morphine",
    "ondansetron",
    "pantoprazole",
    "potassium chloride",
]


def request_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8787", help="Worker base URL")
    parser.add_argument("--drugs", nargs="*", default=COMMON_DRUGS, help="Drug names to seed")
    args = parser.parse_args()

    for drug in args.drugs:
        encoded = urllib.parse.quote(drug)
        payload = request_json(f"{args.base_url.rstrip('/')}/api/drugs/search?q={encoded}&limit=1")
        count = len(payload.get("results", []))
        print(f"{drug}: {count} result(s)")


if __name__ == "__main__":
    main()
