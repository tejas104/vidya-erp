DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ppl_progression_corrections) THEN
    RAISE EXCEPTION 'cannot discard recorded progression corrections';
  END IF;
END $$;
DROP TABLE ppl_progression_corrections;
ALTER TABLE ppl_enrollments DROP CONSTRAINT ppl_enrollments_status_check;
ALTER TABLE ppl_enrollments ADD CONSTRAINT ppl_enrollments_status_check
  CHECK (status IN ('enrolled', 'withdrawn', 'completed'));
