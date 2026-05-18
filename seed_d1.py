#!/usr/bin/env python3
"""Seed Sentinel D1 with curated pharmacology graph data from GPT batch outputs.
Reads all Graph Seed JSON files from Memory Vault and inserts into D1 via CF API."""
import json, os, glob, re, urllib.request, urllib.error

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "66ed97b353e5ddb4255514b9ff042545")
DB_ID = os.environ.get("CF_DB_ID", "d6775ac5-c4d4-426a-9a7a-39d18dc14b4e")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
BASE = "/mnt/s/Memory Vault/projects/Nurse Sentinel Data"

def cf_api(method, path, body=None):
    url = f"https://api.cloudflare.com/client/v4{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "sentinel-seed/1.0"
        })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  CF API error: {e.code} {e.read().decode()[:200]}")
        return None

def d1_query(sql, params=None):
    body = {"sql": sql}
    if params: body["params"] = [str(p) for p in params]
    result = cf_api("POST", f"/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query", body)
    if result and result.get("success"):
        return result["result"]
    return []

def insert_node(entity_type, name, properties=None, source="gpt"):
    props_json = json.dumps(properties) if properties else "{}"
    d1_query(
        "INSERT OR IGNORE INTO graph_nodes (entity_type, name, properties, source) VALUES (?, ?, ?, ?)",
        [entity_type, name, props_json, source]
    )

def insert_edge(source_name, target_name, relationship, weight=1.0):
    # Get node IDs by name
    src = d1_query("SELECT id FROM graph_nodes WHERE name = ?", [source_name])
    tgt = d1_query("SELECT id FROM graph_nodes WHERE name = ?", [target_name])
    if src and tgt:
        d1_query(
            "INSERT OR IGNORE INTO graph_edges (source_node_id, target_node_id, relationship, weight, source) VALUES (?, ?, ?, ?, 'gpt')",
            [src[0][0]["id"], tgt[0][0]["id"], relationship, weight]
        )

# Read all Graph Seed JSON files
json_files = sorted(glob.glob(f"{BASE}/*_entities_graph_seed.json"))
print(f"Found {len(json_files)} graph seed files")

for fpath in json_files:
    batch = os.path.basename(fpath).replace("_entities_graph_seed.json", "")
    print(f"\n=== {batch} ===")
    with open(fpath) as f:
        data = json.load(f)
    
    entities = data.get("entities", [])
    edges = data.get("edges", [])
    print(f"  {len(entities)} entities, {len(edges)} edges")
    
    # Insert entities
    for ent in entities:
        etype = ent.get("type", "concept")
        name = ent.get("name", "")
        if not name: continue
        props = {k: v for k, v in ent.items() if k not in ("type", "name")}
        insert_node(etype, name, props)
    
    # Insert edges
    for edge in edges:
        src = edge.get("source") or edge.get("source_node") or ""
        tgt = edge.get("target") or edge.get("target_node") or ""
        rel = edge.get("relationship") or edge.get("relation") or "related_to"
        if src and tgt:
            insert_edge(src, tgt, rel)

print(f"\nDone seeding graph data")

# Also seed drug table entries for ATI med table data
print(f"\n=== Seeding drug records ===")
# Parse source decks for ATI med table patterns
for fpath in sorted(glob.glob(f"{BASE}/*_source_deck_conversion.md")):
    print(f"  Scanning {os.path.basename(fpath)}...")
    with open(fpath) as f:
        text = f.read()
    # Find ATI Medication Table patterns (generic name in title)
    tables = re.findall(r'## ([A-Z][a-z]+)\s*\(([A-Z][a-z]+)\)\s*\n(.*?)(?=\n## |\Z)', text, re.DOTALL)
    for generic, brand, content in tables:
        props = {"brand_name": brand, "content_preview": content[:200]}
        insert_node("drug", generic, props)
        print(f"    {generic} ({brand})")

print(f"\n=== Seed complete ===")
