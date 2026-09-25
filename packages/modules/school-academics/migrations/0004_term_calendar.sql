ALTER TABLE sca_terms
  ADD COLUMN instructional_days jsonb,
  ADD COLUMN shortfall_threshold numeric(5,2),
  ADD COLUMN calendar_version integer NOT NULL DEFAULT 0;

ALTER TABLE sca_terms ADD CONSTRAINT sca_calendar_days_array_check
  CHECK (instructional_days IS NULL OR jsonb_typeof(instructional_days) = 'array');
ALTER TABLE sca_terms ADD CONSTRAINT sca_shortfall_threshold_check
  CHECK (shortfall_threshold IS NULL OR shortfall_threshold BETWEEN 0 AND 100);
