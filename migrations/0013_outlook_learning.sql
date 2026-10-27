-- Learning from checked outlooks (worker/learning.ts, shared/learning.ts).
-- One row per gauge per UK day: the outlook as predicted at about 07:15, filled in
-- later with the daily peaks SEPA recorded and the rain that fell. Kept as the record
-- of how the outlook did live (and as data for refitting on forecast rain).
CREATE TABLE outlook_snapshots (
  station_no TEXT NOT NULL,
  issued_day TEXT NOT NULL,          -- UK date of the prediction
  issued_at TEXT NOT NULL,
  level_now REAL NOT NULL,
  day_change REAL,                   -- level now minus 24 h ago
  rain_today REAL,                   -- forecast rain used (mm)
  rain_tomorrow REAL,
  rain_day_after REAL,
  shown_basis TEXT,                  -- what the site showed: 'model' | 'trend' (null if no outlook)
  shown_direction TEXT,
  -- Raw model prediction (before learned corrections), null for gauges without a usable model.
  t1 REAL, t1_lo REAL, t1_hi REAL,
  t2 REAL, t2_lo REAL, t2_hi REAL,
  -- Filled in once SEPA publishes them: daily peaks on the day, the next day and the day after.
  actual_d0 REAL,
  actual_t1 REAL,
  actual_t2 REAL,
  -- Rain that fell (Open-Meteo, the next mornings' "yesterday"), to tell model misses from forecast misses.
  rain_fell_d0 REAL,
  rain_fell_t1 REAL,
  PRIMARY KEY (station_no, issued_day)
);
CREATE INDEX outlook_snapshots_day ON outlook_snapshots (issued_day);

ALTER TABLE gauges ADD COLUMN learned TEXT;
