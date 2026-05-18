#!/usr/bin/env python3
"""Seed Sentinel from GPT Graph Seed JSON files.
Maps 'medication' nodes → drugs table, 'condition' nodes → conditions table, edges → xref."""
import json, os, glob, urllib.request, urllib.error

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "66ed97b353e5ddb4255514b9ff042545")
DB_ID = os.environ.get("CF_DB_ID", "d6775ac5-c4d4-426a-9a7a-39d18dc14b4e")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
BASE = "/mnt/s/Memory Vault/projects/Nurse Sentinel Data"

def d1(sql, params=None):
    body = {"sql": sql}
    if params: body["params"] = [str(p) for p in params]
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "sentinel/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  CF error: {e}")
        return None

# D1 batch - send multiple statements
def d1_batch(sqls):
    statements = [{"sql": s} for s in sqls]
    body = {"batch": statements}
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "sentinel/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  Batch error: {e}")
        return None

# Clear old data
print("Clearing old data...")
d1("DELETE FROM drug_condition_xref")
d1("DELETE FROM drugs")
d1("DELETE FROM conditions")
d1("DELETE FROM graph_nodes")
d1("DELETE FROM graph_edges")

# Reset auto-increment
d1("DELETE FROM sqlite_sequence WHERE name IN ('drugs','conditions','graph_nodes','graph_edges')")

drug_id = 0
cond_id = 0
node_id = 0
drug_names = {}  # label → id
cond_names = {}  # label → id
node_names = {}  # label → id

all_nodes = []
all_edges = []

for fpath in sorted(glob.glob(f"{BASE}/*_entities_graph_seed.json")):
    with open(fpath) as f:
        data = json.load(f)
    for n in data.get("nodes", []):
        nid = n.get("id", "")
        label = n.get("label", "")
        ntype = n.get("type", "concept")
        props = {k: v for k, v in n.items() if k not in ("id", "label", "type")}
        all_nodes.append((nid, label, ntype, props))
    for e in data.get("edges", []):
        src = e.get("source", "")
        tgt = e.get("target", "")
        rel = e.get("relationship") or e.get("predicate") or "related_to"
        all_edges.append((src, tgt, rel))

print(f"Total: {len(all_nodes)} nodes, {len(all_edges)} edges")

# Phase 1: Insert medications as drugs
print("\nPhase 1: Medications → drugs table")
drug_inserts = []
for nid, label, ntype, props in all_nodes:
    if ntype == "medication":
        drug_id += 1
        drug_names[nid] = drug_id
        drug_class = ""
        # Find what class this belongs to from edges
        drug_inserts.append(
            f"INSERT INTO drugs (id, name, generic_name, drug_class, brand_names, source) VALUES "
            f"({drug_id}, '{label.replace(chr(39), chr(39)*2)}', '{label.replace(chr(39), chr(39)*2)}', '', '', 'curated')"
        )
        # Also as graph node
        drug_inserts.append(
            f"INSERT INTO graph_nodes (id, entity_type, name, properties, source) VALUES "
            f"({drug_id}, 'drug', '{label.replace(chr(39), chr(39)*2)}', '{json.dumps(props).replace(chr(39), chr(39)*2)}', 'curated')"
        )
        node_names[nid] = drug_id

for i in range(0, len(drug_inserts), 25):
    d1_batch(drug_inserts[i:i+25])
print(f"  {drug_id} drugs inserted")

# Phase 2: Insert conditions from condition-type nodes
print("\nPhase 2: Conditions → conditions table")
cond_start = drug_id + 1
cond_inserts = []
for nid, label, ntype, props in all_nodes:
    if ntype in ("condition", "side_effect", "contraindication"):
        cond_id += 1
        cid = cond_start + cond_id - 1
        cond_names[nid] = cid
        cond_inserts.append(
            f"INSERT INTO conditions (id, name, description, source) VALUES "
            f"({cid}, '{label.replace(chr(39), chr(39)*2)}', '', 'curated')"
        )
        cond_inserts.append(
            f"INSERT INTO graph_nodes (id, entity_type, name, properties, source) VALUES "
            f"({cid}, 'condition', '{label.replace(chr(39), chr(39)*2)}', '{json.dumps(props).replace(chr(39), chr(39)*2)}', 'curated')"
        )
        node_names[nid] = cid

# Also add medication_class and other types as graph nodes
type_counts = {}
for nid, label, ntype, props in all_nodes:
    type_counts[ntype] = type_counts.get(ntype, 0) + 1
    if ntype not in ("medication", "condition", "side_effect", "contraindication") and nid not in node_names:
        node_id += 1
        gid = cond_start + cond_id + node_id
        node_names[nid] = gid
        cond_inserts.append(
            f"INSERT INTO graph_nodes (id, entity_type, name, properties, source) VALUES "
            f"({gid}, '{ntype.replace(chr(39), chr(39)*2)}', '{label.replace(chr(39), chr(39)*2)}', '{json.dumps(props).replace(chr(39), chr(39)*2)}', 'curated')"
        )

for i in range(0, len(cond_inserts), 25):
    d1_batch(cond_inserts[i:i+25])
print(f"  {cond_id} conditions, {node_id} other nodes inserted")
print(f"  Type breakdown: {type_counts}")

# Phase 3: Insert edges
print("\nPhase 3: Edges → graph_edges + drug_condition_xref")
edge_inserts = []
xref_inserts = []
edge_count = 0

for src, tgt, rel in all_edges:
    src_id = node_names.get(src)
    tgt_id = node_names.get(tgt)
    if src_id and tgt_id:
        edge_count += 1
        edge_inserts.append(
            f"INSERT INTO graph_edges (source_node_id, target_node_id, relationship, weight, source) VALUES "
            f"({src_id}, {tgt_id}, '{rel.replace(chr(39), chr(39)*2)}', 1.0, 'curated')"
        )
        # If src is a drug and tgt is a condition (or vice versa), create xref
        if src in drug_names and tgt in cond_names:
            xref_inserts.append(
                f"INSERT INTO drug_condition_xref (drug_id, condition_id, relationship) VALUES "
                f"({drug_names[src]}, {cond_names[tgt]}, '{rel.replace(chr(39), chr(39)*2)}')"
            )
        elif tgt in drug_names and src in cond_names:
            xref_inserts.append(
                f"INSERT INTO drug_condition_xref (drug_id, condition_id, relationship) VALUES "
                f"({drug_names[tgt]}, {cond_names[src]}, '{rel.replace(chr(39), chr(39)*2)}')"
            )

for i in range(0, len(edge_inserts), 25):
    d1_batch(edge_inserts[i:i+25])
for i in range(0, len(xref_inserts), 25):
    d1_batch(xref_inserts[i:i+25])
print(f"  {edge_count} edges, {len(xref_inserts)} drug-condition xrefs inserted")

# Verify
r = d1("SELECT COUNT(*) as c FROM drugs")
drug_count = r['result'][0]['results'][0]['c'] if r and r.get('result') else 0
r = d1("SELECT COUNT(*) as c FROM conditions")
cond_count = r['result'][0]['results'][0]['c'] if r and r.get('result') else 0
r = d1("SELECT COUNT(*) as c FROM graph_nodes")
node_count = r['result'][0]['results'][0]['c'] if r and r.get('result') else 0
r = d1("SELECT COUNT(*) as c FROM graph_edges")
edge_total = r['result'][0]['results'][0]['c'] if r and r.get('result') else 0

print(f"\n{'='*40}")
print(f"Verification:")
print(f"  Drugs: {drug_count}")
print(f"  Conditions: {cond_count}")
print(f"  Graph nodes: {node_count}")
print(f"  Graph edges: {edge_total}")
print(f"{'='*40}")
