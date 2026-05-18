#!/usr/bin/env python3
"""Backfill enriched_at and raw text fields using SQL files."""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

PROJECT = Path("/mnt/s/Projects/sentinel")
STAGING = PROJECT / "staging"

def run_sql(sql: str) -> dict:
    r = subprocess.run(
        ["wrangler", "d1", "execute", "sentinel-db", "--remote", f"--command={sql}"],
        cwd=PROJECT, capture_output=True, text=True, timeout=60
    )
    try:
        start = r.stdout.index("[")
        end = r.stdout.rindex("]") + 1
        parsed = json.loads(r.stdout[start:end])
        return {"results": parsed[0].get("results", []) if parsed else []}
    except:
        return {"results": []}

def run_sql_file(path: Path, label: str = ""):
    print(f"  Running {label or path.name}...")
    r = subprocess.run(
        ["wrangler", "d1", "execute", "sentinel-db", "--remote", f"--file={path}"],
        cwd=PROJECT, capture_output=True, text=True, timeout=120
    )
    if r.returncode != 0:
        print(f"  ERR: {r.stderr[:300]}")
        return False
    for line in r.stdout.split('\n'):
        if 'Rows written' in line or 'success' in line.lower() and 'true' in line.lower():
            print(f"    {line.strip()}")
            break
    return True

# Step 1: Set enriched_at for all drugs with FDA data
print("=== Step 1: Setting enriched_at ===")
result = run_sql(
    "UPDATE drugs SET enriched_at = COALESCE(assembled_at, datetime('now')) "
    "WHERE enriched_at IS NULL AND source LIKE '%fda%' AND label_raw IS NOT NULL;"
)
print(f"  Done.")

# Step 2: Get all drugs that need raw fields
print("\n=== Step 2: Fetching drugs needing raw fields ===")
needed = run_sql(
    "SELECT id, name, label_raw FROM drugs "
    "WHERE (indications_raw IS NULL OR indications_raw = '[]') "
    "AND source LIKE '%fda%' AND label_raw IS NOT NULL "
    "ORDER BY id LIMIT 500;"
)
drugs = needed.get("results", [])
print(f"  {len(drugs)} drugs need raw field backfill")

if not drugs:
    print("  Nothing to do.")
    sys.exit(0)

# Step 3: Parse label_raw and generate SQL file
print("\n=== Step 3: Generating backfill SQL ===")

# Map raw column -> possible JSON keys (some labels use different naming)
FIELD_MAP = {
    "indications_raw": ["indications_and_usage"],
    "contraindications_raw": ["contraindications"],
    "side_effects_raw": ["adverse_reactions", "side_effects"],
    "interactions_raw": ["drug_interactions"],
    "monitoring_raw": ["warnings_and_cautions", "warnings"],
}

def extract_section(data, keys):
    """Try each key, return list of cleaned strings or empty list."""
    for key in keys:
        val = data.get(key)
        if isinstance(val, list):
            cleaned = [str(i).replace('\n', ' ').strip() for i in val if str(i).strip()]
            if cleaned:
                return cleaned
        elif isinstance(val, str) and val.strip():
            return [val.strip()]
    return []

sql_path = STAGING / "backfill_raw_fields.sql"
updated_count = 0
drugs_updated = 0

with open(sql_path, "w") as f:
    f.write("-- Backfill raw fields from label_raw JSON\n\n")
    for drug in drugs:
        label_raw = drug.get("label_raw", "")
        if not label_raw:
            continue
        
        try:
            data = json.loads(label_raw)
            # Handle both formats: direct dict or {results: [{...}]}
            if isinstance(data, list):
                data = data[0] if data else {}
            elif isinstance(data, dict) and "results" in data:
                data = data["results"][0] if data.get("results") else data
        except json.JSONDecodeError:
            continue
        
        sets = []
        for col, keys in FIELD_MAP.items():
            items = extract_section(data, keys)
            if items:
                # Escape single quotes for SQL
                safe = json.dumps(items).replace("'", "''")
                sets.append(f"{col} = '{safe}'")
        
        if sets:
            f.write(f"UPDATE drugs SET {', '.join(sets)} WHERE id = {drug['id']};\n")
            updated_count += len(sets)
            drugs_updated += 1

print(f"  Generated {sql_path.name}: {drugs_updated} drugs, {updated_count} field updates")

# Step 4: Run the SQL file in batches
print("\n=== Step 4: Executing backfill ===")
if drugs_updated > 0:
    # Split into smaller files if needed (D1 has statement limits)
    import os
    sql_content = sql_path.read_text()
    lines = sql_content.strip().split('\n')
    non_comment_lines = [l for l in lines if l.strip() and not l.startswith('--')]
    
    if len(non_comment_lines) <= 200:
        run_sql_file(sql_path, "raw fields backfill")
    else:
        # Split into chunks of 100
        chunk_size = 100
        for chunk_start in range(0, len(non_comment_lines), chunk_size):
            chunk = non_comment_lines[chunk_start:chunk_start + chunk_size]
            chunk_path = STAGING / f"backfill_raw_{chunk_start}.sql"
            chunk_path.write_text('\n'.join(chunk))
            run_sql_file(chunk_path, f"raw fields batch {chunk_start}-{chunk_start+len(chunk)}")
            chunk_path.unlink()  # Clean up temp files
    
    sql_path.unlink()  # Clean up main file

# Step 5: Verify
print("\n=== Verification ===")
v1 = run_sql("SELECT COUNT(*) as c FROM drugs WHERE enriched_at IS NULL AND source LIKE '%fda%';")
v2 = run_sql("SELECT COUNT(*) as c FROM drugs WHERE indications_raw IS NOT NULL AND indications_raw != '[]' AND source LIKE '%fda%';")
missing_e = v1.get("results", [{}])[0].get("c", "?")
populated = v2.get("results", [{}])[0].get("c", "?")
total = run_sql("SELECT COUNT(*) as c FROM drugs WHERE source LIKE '%fda%';")
total_fda = total.get("results", [{}])[0].get("c", "?")
print(f"  Total FDA drugs: {total_fda}")
print(f"  Missing enriched_at: {missing_e}")
print(f"  With indications_raw: {populated}")
