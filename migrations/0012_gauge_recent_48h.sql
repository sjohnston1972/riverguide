-- The sparklines now show two days: clear the stored day so the next poll fetches each gauge's last 48 hours.
UPDATE gauges SET recent = NULL;
