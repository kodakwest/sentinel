CREATE TABLE IF NOT EXISTS drugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rxcui TEXT,
  name TEXT UNIQUE NOT NULL,
  generic_name TEXT,
  drug_class TEXT,
  brand_names TEXT,
  indications TEXT,
  contraindications TEXT,
  black_box_warnings TEXT,
  side_effects TEXT,
  interactions TEXT,
  monitoring TEXT,
  indications_raw TEXT,
  contraindications_raw TEXT,
  side_effects_raw TEXT,
  interactions_raw TEXT,
  monitoring_raw TEXT,
  allergies TEXT,
  administration TEXT,
  pregnancy_category TEXT,
  label_raw TEXT,
  images TEXT,
  source TEXT,
  assembled_at TEXT,
  enriched_at TEXT
);

CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  symptoms TEXT,
  treatments TEXT,
  related_conditions TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS drug_condition_xref (
  drug_id INTEGER,
  condition_id INTEGER,
  relationship TEXT,
  FOREIGN KEY (drug_id) REFERENCES drugs(id),
  FOREIGN KEY (condition_id) REFERENCES conditions(id)
);

CREATE TABLE IF NOT EXISTS explain_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  drug TEXT,
  context TEXT,
  explanation TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  properties TEXT,
  source TEXT,
  user_id TEXT DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,
  relationship TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  source TEXT DEFAULT 'curated',
  FOREIGN KEY (source_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (target_node_id) REFERENCES graph_nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_drugs_search ON drugs(name, generic_name);
CREATE INDEX IF NOT EXISTS idx_conditions_name ON conditions(name);
CREATE INDEX IF NOT EXISTS idx_explain_cache ON explain_cache(term, drug, context);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(entity_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
