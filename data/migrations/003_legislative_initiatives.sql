PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legislative_initiatives (
  expediente TEXT PRIMARY KEY,
  legislature INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  author TEXT,
  presented_on TEXT,
  qualified_on TEXT,
  status TEXT NOT NULL,
  official_result TEXT,
  current_stage TEXT,
  official_url TEXT NOT NULL,
  source_dataset_url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS initiative_documents (
  id INTEGER PRIMARY KEY,
  expediente TEXT NOT NULL REFERENCES legislative_initiatives(expediente) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  UNIQUE (expediente, url)
);

CREATE INDEX IF NOT EXISTS initiatives_presented_on_idx ON legislative_initiatives(presented_on);
CREATE INDEX IF NOT EXISTS initiative_documents_expediente_idx ON initiative_documents(expediente);
