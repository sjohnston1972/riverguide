-- Community level reports: "I paddled it and it was <verdict>", with the gauge level at the time.
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL REFERENCES sections(slug) ON DELETE CASCADE,
  station_no  TEXT,
  paddled_at  TEXT NOT NULL,
  level       REAL,
  verdict     TEXT NOT NULL,
  note        TEXT,
  device      TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  note_hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reports_slug ON reports(slug, hidden);
CREATE INDEX reports_ip_day ON reports(ip_hash, created_at);

-- "Same for me" (+1) / "Not for me" (-1); one per device per report.
CREATE TABLE report_votes (
  report_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  device     TEXT NOT NULL,
  vote       INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, device)
);

-- Abuse flags on notes; one per device per report.
CREATE TABLE report_flags (
  report_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  device     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, device)
);

-- Thresholds derived from reports, recomputed whenever a section's reports or votes change.
CREATE TABLE community_bands (
  slug       TEXT NOT NULL,
  station_no TEXT NOT NULL,
  min_level  REAL,
  max_level  REAL,
  reports    INTEGER NOT NULL,
  people     INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (slug, station_no)
);
