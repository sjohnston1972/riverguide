-- Level about 24 hours before the latest reading: the level outlook's trend input.
ALTER TABLE gauges ADD COLUMN level_day_ago REAL;
ALTER TABLE gauges ADD COLUMN level_day_ago_at TEXT;
