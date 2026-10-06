-- SEPA level gauges. Metadata refreshed daily, readings every 15 minutes.
CREATE TABLE gauges (
  station_no     TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  river          TEXT,
  catchment      TEXT,
  lat            REAL NOT NULL,
  lon            REAL NOT NULL,
  ts_id          TEXT NOT NULL,
  typical_low    REAL,
  typical_high   REAL,
  level          REAL,
  level_at       TEXT,
  level_hour_ago REAL,
  updated_at     TEXT
);

-- River sections (one per guidebook entry). guide_text is JSON and is only
-- ever returned to clients when SHOW_FULL_GUIDE_TEXT is enabled.
CREATE TABLE sections (
  slug               TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  river              TEXT NOT NULL,
  section_name       TEXT,
  region             TEXT NOT NULL,
  grade_text         TEXT NOT NULL,
  grade_min          REAL,
  grade_max          REAL,
  length_text        TEXT,
  time_text          TEXT,
  character          TEXT,
  lat                REAL,
  lon                REAL,
  location_precision TEXT,
  put_in             TEXT,
  take_out           TEXT,
  ukrgb_url          TEXT NOT NULL,
  source_updated     TEXT,
  guide_text         TEXT
);

-- Section -> gauge links with paddling thresholds (metres).
CREATE TABLE section_gauges (
  slug       TEXT NOT NULL REFERENCES sections(slug) ON DELETE CASCADE,
  station_no TEXT NOT NULL REFERENCES gauges(station_no),
  relation   TEXT NOT NULL,
  min_level  REAL,
  max_level  REAL,
  basis      TEXT NOT NULL,
  confidence TEXT NOT NULL,
  reason     TEXT NOT NULL,
  PRIMARY KEY (slug, station_no)
);
CREATE INDEX section_gauges_station ON section_gauges(station_no);

-- Chat abuse/cost controls.
CREATE TABLE chat_usage (
  day      TEXT NOT NULL,
  ip_hash  TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip_hash)
);

CREATE TABLE spend (
  day          TEXT PRIMARY KEY,
  microdollars INTEGER NOT NULL DEFAULT 0,
  requests     INTEGER NOT NULL DEFAULT 0
);
