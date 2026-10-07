-- Hydro dam releases from SSE's freshet schedule, published by SEPA; refreshed
-- daily (worker/freshets.ts). One row per release, keyed by source (a release
-- location such as 'garry'); sections are mapped to sources in shared/freshets.ts.
CREATE TABLE freshets (
  source    TEXT NOT NULL,
  location  TEXT NOT NULL,
  -- UK local time, "YYYY-MM-DDTHH:MM", as written in the schedule.
  start     TEXT NOT NULL,
  end       TEXT NOT NULL,
  volume_m3 REAL NOT NULL,
  hours     REAL NOT NULL,
  PRIMARY KEY (source, start)
);
CREATE INDEX freshets_end ON freshets(end);
