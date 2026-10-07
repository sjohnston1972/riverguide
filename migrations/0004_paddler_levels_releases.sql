-- Paddler-set level scale on a gauge link (Where's the Water, CC BY-SA 4.0):
-- JSON {"scrape","low","medium","high","very_high","huge"} in metres.
ALTER TABLE section_gauges ADD COLUMN levels TEXT;

-- Where a section's information comes from: 'guidebook' (original data) or 'wtw' (Where's the Water).
ALTER TABLE sections ADD COLUMN source TEXT NOT NULL DEFAULT 'guidebook';
-- Note about scheduled releases (e.g. "daylight ebb flows over 3.2 m range").
ALTER TABLE sections ADD COLUMN release_note TEXT;

-- Scheduled dam releases and tidal windows, one row per day (UK local date).
CREATE TABLE releases (
  slug TEXT NOT NULL REFERENCES sections(slug) ON DELETE CASCADE,
  day  TEXT NOT NULL,
  PRIMARY KEY (slug, day)
);
CREATE INDEX releases_day ON releases(day);
