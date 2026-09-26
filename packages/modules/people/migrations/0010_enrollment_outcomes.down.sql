-- Recorded progression outcomes are pupil history; never discard them on rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ppl_enrollments WHERE outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot roll back people/0010 while recorded enrollment outcomes exist';
  END IF;
END $$;

ALTER TABLE ppl_enrollments DROP CONSTRAINT ppl_enrollments_outcome_reason_check;
ALTER TABLE ppl_enrollments DROP CONSTRAINT ppl_enrollments_outcome_check;
ALTER TABLE ppl_enrollments DROP COLUMN outcome_reason, DROP COLUMN outcome;
