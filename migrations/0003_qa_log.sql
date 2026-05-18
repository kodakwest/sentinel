CREATE TABLE IF NOT EXISTS qa_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  query TEXT NOT NULL,
  drug TEXT,
  section_context TEXT,
  mode TEXT DEFAULT 'quick',
  drug_data_snapshot TEXT,
  search_results_snapshot TEXT,
  response TEXT NOT NULL,
  response_length INTEGER,
  cached INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qa_log_created ON qa_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_log_drug ON qa_log(drug);
CREATE INDEX IF NOT EXISTS idx_qa_log_mode ON qa_log(mode);
