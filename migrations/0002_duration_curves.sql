-- Level-duration curve per gauge: JSON [[pct_of_days, level_m], ...] from SEPA daily maxima.
ALTER TABLE gauges ADD COLUMN duration_curve TEXT;
