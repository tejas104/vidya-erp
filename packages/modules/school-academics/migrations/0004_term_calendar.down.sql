ALTER TABLE sca_terms DROP CONSTRAINT sca_shortfall_threshold_check;
ALTER TABLE sca_terms DROP CONSTRAINT sca_calendar_days_array_check;
ALTER TABLE sca_terms DROP COLUMN calendar_version;
ALTER TABLE sca_terms DROP COLUMN shortfall_threshold;
ALTER TABLE sca_terms DROP COLUMN instructional_days;
