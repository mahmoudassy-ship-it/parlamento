PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS deputy_images (
  deputy_id INTEGER PRIMARY KEY REFERENCES deputies(id) ON DELETE CASCADE,
  wikidata_id TEXT NOT NULL UNIQUE,
  commons_file TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_page_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  artist TEXT,
  credit TEXT,
  updated_at TEXT NOT NULL
);
