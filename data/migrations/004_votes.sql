PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS voting_events (
  id INTEGER PRIMARY KEY,
  legislature INTEGER NOT NULL,
  session_number INTEGER NOT NULL,
  vote_number INTEGER NOT NULL,
  voted_on TEXT NOT NULL,
  expediente TEXT,
  title TEXT NOT NULL,
  initiative_text TEXT,
  subgroup_title TEXT,
  vote_text TEXT,
  assent TEXT,
  present_count INTEGER NOT NULL,
  yes_count INTEGER NOT NULL,
  no_count INTEGER NOT NULL,
  abstain_count INTEGER NOT NULL,
  not_voting_count INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (legislature, session_number, vote_number)
);

CREATE TABLE IF NOT EXISTS member_votes (
  voting_event_id INTEGER NOT NULL REFERENCES voting_events(id) ON DELETE CASCADE,
  deputy_id INTEGER REFERENCES deputies(id) ON DELETE SET NULL,
  member_name TEXT NOT NULL,
  parliamentary_group_code TEXT,
  seat TEXT,
  choice TEXT NOT NULL CHECK (choice IN ('yes', 'no', 'abstain', 'not_voting')),
  PRIMARY KEY (voting_event_id, member_name)
);

CREATE INDEX IF NOT EXISTS voting_events_expediente_idx ON voting_events(expediente);
CREATE INDEX IF NOT EXISTS voting_events_date_idx ON voting_events(voted_on);
CREATE INDEX IF NOT EXISTS member_votes_deputy_idx ON member_votes(deputy_id);
