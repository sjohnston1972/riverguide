-- SEPA's own rising/falling indicator per gauge (15m.RisingFalling.Cmd: -1 falling,
-- 0 steady, 1 rising), the series that drives the arrows on SEPA's site.
ALTER TABLE gauges ADD COLUMN rf_ts_id TEXT;
ALTER TABLE gauges ADD COLUMN trend_sepa INTEGER;
ALTER TABLE gauges ADD COLUMN trend_sepa_at TEXT;
