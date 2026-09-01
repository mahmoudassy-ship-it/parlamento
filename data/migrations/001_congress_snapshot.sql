PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT,
  description TEXT,
  website TEXT
);

CREATE TABLE IF NOT EXISTS parliamentary_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  short_name TEXT
);

CREATE TABLE IF NOT EXISTS deputies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  constituency TEXT NOT NULL,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  parliamentary_group_id INTEGER NOT NULL REFERENCES parliamentary_groups(id),
  full_status_on TEXT,
  joined_on TEXT,
  group_joined_on TEXT,
  group_left_on TEXT,
  biography TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_state (
  source TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS deputies_party_id_idx ON deputies(party_id);
CREATE INDEX IF NOT EXISTS deputies_group_id_idx ON deputies(parliamentary_group_id);
