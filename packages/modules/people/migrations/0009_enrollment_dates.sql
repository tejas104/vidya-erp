ALTER TABLE ppl_enrollments
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date;

ALTER TABLE ppl_enrollments
  ADD CONSTRAINT ppl_enrollments_effective_dates_check
  CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on);

-- Existing rows remain unknown: created_at is an entry timestamp, not an admission date.
CREATE INDEX ppl_enrollments_section_year_idx
  ON ppl_enrollments (section_id, academic_year);
