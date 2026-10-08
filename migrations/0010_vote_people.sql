-- Count "same for me" / "not for me" votes and note flags per person (hashed IP), not per device,
-- so a handful of devices on one connection can't add weight, dispute a report or hide a note.
-- Older rows have NULL and fall back to the device.
ALTER TABLE report_votes ADD COLUMN ip_hash TEXT;
ALTER TABLE report_flags ADD COLUMN ip_hash TEXT;
