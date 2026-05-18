"""Seed Sentinel D1 with all graph seed batches.
Handles both 'nodes' format (label/type) and 'entities' format (name/entity_type)."""
import json, os, glob, sys, time, urllib.request, urllib.error

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "66ed97b353e5ddb4255514b9ff042545")
DB_ID = os.environ.get("CF_DB_ID", "d6775ac5-c4d4-426a-9a7a-39d18dc14b4e")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
BASE = "/mnt/s/Memory Vault/projects/Nurse Sentinel Data"

def d1_query(sql, params=None):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query"
    body = {"sql": sql}
    if params:
        body["params"] = [str(p) if p is not None else None for p in params]
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  D1 error ({e.code}): {body[:200]}", flush=True)
        return None
    except Exception as e:
        print(f"  Error: {e}", flush=True)
        return None

total_nodes = 0
total_edges = 0
total_errors = 0

# Process each batch file
for fpath in sorted(glob.glob(BASE + "/pharmacology_batch*_entities_graph_seed.json")):
    batch = fpath.split("/")[-1].replace("_entities_graph_seed.json", "")
    print(f"\n=== {batch} ===", flush=True)
    
    with open(fpath) as f:
        data = json.load(f)
    
    # Handle both formats
    nodes = data.get("nodes", data.get("entities", []))
    edges = data.get("edges", [])
    
    # Map node format to standardized fields
    node_map = {}  # id/label -> db_id
    
    for node in nodes:
        node_id = node.get("id") or node.get("name", "")
        label = node.get("label") or node.get("name", "")
        ntype = node.get("type") or node.get("entity_type", "concept")
        if not label:
            continue
        
        props = {k: v for k, v in node.items() if k not in ("id", "label", "name", "type", "entity_type")}
        props_json = json.dumps(props)
        
        r = d1_query(
            "INSERT OR IGNORE INTO graph_nodes (entity_type, name, properties, source) VALUES (?, ?, ?, ?)",
            [ntype, label, props_json, batch]
        )
        if r and r.get("success") and r["result"] and r["result"][0].get("success"):
            total_nodes += 1
        
        # Get the node ID for edge linking
        r2 = d1_query(
            "SELECT id FROM graph_nodes WHERE LOWER(name) = LOWER(?) AND entity_type = ? LIMIT 1",
            [label, ntype]
        )
        if r2 and r2.get("success") and r2["result"] and r2["result"][0].get("results"):
            row_id = r2["result"][0]["results"][0]["id"]
            node_map[node_id.lower()] = row_id
            node_map[label.lower()] = row_id
    
    batch_nodes = len(nodes)
    print(f"  {batch_nodes} nodes processed", flush=True)
    
    # Insert edges
    for edge in edges:
        src_key = (edge.get("source") or edge.get("subject", "")).lower()
        tgt_key = (edge.get("target") or edge.get("object", "")).lower()
        rel = edge.get("relationship") or edge.get("predicate") or "related_to"
        weight = edge.get("weight", 1.0)
        
        if not src_key or not tgt_key:
            continue
        
        src_id = node_map.get(src_key)
        tgt_id = node_map.get(tgt_key)
        if not src_id and src_key in node_map:
            src_id = node_map[src_key]
        
        if src_id and tgt_id:
            r = d1_query(
                "INSERT OR IGNORE INTO graph_edges (source_node_id, target_node_id, relationship, weight, source) VALUES (?, ?, ?, ?, ?)",
                [src_id, tgt_id, rel, weight, batch]
            )
            if r and r.get("success") and r["result"] and r["result"][0].get("success"):
                total_edges += 1
        else:
            total_errors += 1
    
    batch_edges = len(edges)
    print(f"  {len(edges)} edges processed", flush=True)
    
    time.sleep(0.5)  # rate limit buffer

print(f"\n{'='*50}", flush=True)
print(f"DONE: {total_nodes} nodes, {total_edges} edges, {total_errors} failed lookups", flush=True)
