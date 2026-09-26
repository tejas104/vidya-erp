DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ppl_colleges WHERE guardian_history_days <> 90 OR guardian_history_version <> 1) THEN
    RAISE EXCEPTION 'Cannot discard configured guardian history policy';
  END IF;
END $$;
ALTER TABLE ppl_colleges DROP CONSTRAINT ppl_colleges_guardian_history_version_check;
ALTER TABLE ppl_colleges DROP CONSTRAINT ppl_colleges_guardian_history_days_check;
ALTER TABLE ppl_colleges DROP COLUMN guardian_history_version;
ALTER TABLE ppl_colleges DROP COLUMN guardian_history_days;
