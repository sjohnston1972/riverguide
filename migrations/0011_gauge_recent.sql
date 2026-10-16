-- The last day of each gauge's readings, one per hour (JSON, shared/recent.ts): the river list's sparklines.
ALTER TABLE gauges ADD COLUMN recent TEXT;
