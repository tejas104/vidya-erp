DROP INDEX ppl_enrollments_section_year_idx;
ALTER TABLE ppl_enrollments DROP CONSTRAINT ppl_enrollments_effective_dates_check;
ALTER TABLE ppl_enrollments DROP COLUMN ends_on, DROP COLUMN starts_on;
