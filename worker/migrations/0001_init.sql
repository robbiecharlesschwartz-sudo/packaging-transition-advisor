-- Core corpus
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_url TEXT NOT NULL,
  layer TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  doc_date TEXT,
  fetched_date TEXT,
  reg_status TEXT DEFAULT 'n/a',
  reliability TEXT NOT NULL,
  license TEXT NOT NULL,
  content_hash TEXT,
  material_tags TEXT DEFAULT '[]',
  package_tags TEXT DEFAULT '[]',
  summary TEXT,
  chunk_count INTEGER DEFAULT 0
);
CREATE INDEX idx_documents_layer ON documents(layer);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  page INTEGER,
  section TEXT,
  layer TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  doc_date TEXT,
  license TEXT NOT NULL,
  material_tags TEXT DEFAULT '[]',
  package_tags TEXT DEFAULT '[]'
);
CREATE INDEX idx_chunks_doc ON chunks(document_id);
CREATE INDEX idx_chunks_layer_j ON chunks(layer, jurisdiction);

-- Keyword side of hybrid search. Kept in sync by the ingest endpoint.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  title,
  section,
  content,
  tokenize = 'porter unicode61'
);

-- Runs and step logs (Workflows only retains state for 3 days on free plan)
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  profile TEXT,
  question TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  output TEXT,
  retrieved_chunk_ids TEXT DEFAULT '[]',
  is_example INTEGER NOT NULL DEFAULT 0,
  example_slug TEXT,
  model TEXT,
  error TEXT
);
CREATE INDEX idx_runs_example ON runs(is_example);

CREATE TABLE run_steps (
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  summary TEXT,
  detail TEXT,
  PRIMARY KEY (run_id, step_id)
);

-- Structured data (every value carries a citation back to a document/chunk)
CREATE TABLE price_inputs (
  id TEXT PRIMARY KEY,
  material TEXT NOT NULL,
  kind TEXT NOT NULL,
  unit TEXT NOT NULL,
  low REAL,
  high REAL,
  base_period TEXT,
  ppi_series TEXT,
  source_doc_id TEXT,
  source_chunk_id TEXT,
  source_url TEXT,
  note TEXT,
  reliability TEXT,
  reviewed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE epr_fees (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  material_category TEXT NOT NULL,
  material_keys TEXT NOT NULL DEFAULT '[]',
  fee_per_kg REAL NOT NULL,
  fee_unit_original TEXT,
  effective_date TEXT,
  source_doc_id TEXT,
  source_chunk_id TEXT,
  source_url TEXT
);
CREATE INDEX idx_epr_state ON epr_fees(state);

CREATE TABLE state_laws (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  law_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  enacted_date TEXT,
  key_date TEXT,
  key_date_event TEXT,
  note TEXT,
  source_doc_id TEXT,
  source_url TEXT
);
CREATE INDEX idx_state_laws_state ON state_laws(state);

CREATE TABLE ppi_series (
  series_id TEXT NOT NULL,
  period TEXT NOT NULL,
  value REAL NOT NULL,
  label TEXT,
  PRIMARY KEY (series_id, period)
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  website TEXT,
  inquiry_url TEXT,
  material_tags TEXT DEFAULT '[]',
  product_tags TEXT DEFAULT '[]',
  certifications TEXT DEFAULT '[]',
  scale_tier TEXT,
  source_doc_ids TEXT DEFAULT '[]',
  evidence TEXT,
  last_verified TEXT
);

CREATE TABLE supplier_plants (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  city TEXT,
  state TEXT NOT NULL,
  lat REAL,
  lng REAL,
  plant_type TEXT,
  source_doc_id TEXT
);
CREATE INDEX idx_plants_supplier ON supplier_plants(supplier_id);

CREATE TABLE supplier_prices (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  product_desc TEXT,
  unit TEXT,
  low REAL,
  high REAL,
  moq TEXT,
  captured_date TEXT,
  source_url TEXT
);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);

CREATE TABLE corpus_changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  document_id TEXT,
  change TEXT NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
