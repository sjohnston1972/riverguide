-- Level outlook: per-gauge forecast model (JSON, from scripts/fit-forecast.ts)
-- and daily rainfall around now (JSON: yesterday, today, tomorrow, day after),
-- refreshed hourly by the Worker.
ALTER TABLE gauges ADD COLUMN forecast_model TEXT;
ALTER TABLE gauges ADD COLUMN rain TEXT;
ALTER TABLE gauges ADD COLUMN outlook TEXT;
