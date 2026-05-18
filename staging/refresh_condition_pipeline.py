#!/usr/bin/env python3
"""
Weekly condition data refresh pipeline.
Checks DOID, HPO, and MONDO for updates and syncs to Sentinel D1.
Run via cron:  0 6 * * 1  cd /mnt/s/Projects/sentinel && python3 staging/refresh_condition_pipeline.py
"""
from __future__ import annotations
import json, subprocess, sys, hashlib, time
from pathlib import Path
from datetime import datetime

STAGING = Path(__file__).resolve().parent
PROJECT = STAGING.parent
MANIFEST = STAGING / ".pipeline_manifest.json"

SOURCES = {
    "doid": "https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/src/ontology/doid.obo",
    "hpo_annotations": "https://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa",
    "mondo": "https://purl.obolibrary.org/obo/mondo.obo",
}

def hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16] if path.exists() else ""

def run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

def check_for_updates() -> bool:
    """Returns True if any source has changed."""
    manifest = {"sources": {}, "last_checked": None}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text())

    changed = False
    for name, url in SOURCES.items():
        tmp = STAGING / f".check_{name}"
        # Quick head request to check Last-Modified
        r = run(["curl", "-sI", "--max-time", "15", url])
        last_mod = None
        for line in r.stdout.lower().split("\n"):
            if line.startswith("last-modified:"):
                last_mod = line.split(":", 1)[1].strip()
                break
        
        prev = manifest.get("sources", {}).get(name, {})
        prev_last_mod = prev.get("last_modified")
        
        if last_mod and last_mod != prev_last_mod:
            print(f"  {name}: modified ({prev_last_mod} → {last_mod})")
            prev["last_modified"] = last_mod
            prev["fetched"] = None
            changed = True
        
        if not prev.get("fetched"):
            # Download and verify
            print(f"  Downloading {name}...")
            ext = "obo" if name != "hpo_annotations" else "hpoa"
            dest = STAGING / f"source_{name}.{ext}"
            result = run(["curl", "-L", "--max-time", "120", "-o", str(dest), url])
            if result.returncode == 0:
                prev["fetched"] = datetime.utcnow().isoformat()
                prev["hash"] = hash_file(dest)
                prev["size"] = dest.stat().st_size
                print(f"    {dest.name}: {prev.get('size', 0):,} bytes")
                changed = True
            else:
                print(f"    FAILED: {result.stderr[:200]}")

    manifest["sources"] = manifest.get("sources", {})
    manifest["sources"].update({name: manifest["sources"].get(name, {}) for name in SOURCES})
    for name in SOURCES:
        if name not in manifest["sources"]:
            manifest["sources"][name] = {}
    manifest["last_checked"] = datetime.utcnow().isoformat()
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    return changed

def build_and_import():
    """Rebuild staged data and import to D1."""
    print("\nRebuilding staged datasets via build script...")
    # Need to re-run the full build pipeline
    # For now, rely on the existing merge script
    result = run(["python3", str(STAGING / "merge_condition_datasets.py")], timeout=600)
    print(result.stdout[-1000:] if len(result.stdout) > 1000 else result.stdout)
    if result.returncode != 0:
        print(f"Import errors: {result.stderr[:500]}")

def main():
    print(f"Condition data pipeline — {datetime.utcnow().isoformat()}")
    print("Checking sources for updates...")
    
    if not check_for_updates():
        print("No changes detected.")
        return
    
    print("\nChanges detected. Proceeding with rebuild...")
    build_and_import()
    
    # Log the run
    log = STAGING / ".pipeline_log.txt"
    with open(log, "a") as f:
        f.write(f"{datetime.utcnow().isoformat()}: refresh completed\n")
    print(f"\nLogged to {log}")

if __name__ == "__main__":
    main()
