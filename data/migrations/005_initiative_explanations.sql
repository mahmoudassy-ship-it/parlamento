PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS initiative_explanations (
  expediente TEXT PRIMARY KEY REFERENCES legislative_initiatives(expediente) ON DELETE CASCADE,
  plain_title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
