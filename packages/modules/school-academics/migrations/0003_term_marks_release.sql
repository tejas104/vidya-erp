-- Existing closed terms stay private on rollout. A new close or an explicit
-- administrator release stamps this field; reopening clears it.
ALTER TABLE sca_terms ADD COLUMN marks_released_at timestamptz;

-- Keep older app instances safe during a rolling deploy: their reopen path
-- changes status without knowing this column, and must still revoke release.
CREATE FUNCTION sca_clear_marks_release_on_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'open' THEN NEW.marks_released_at := NULL; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sca_clear_marks_release_on_reopen
BEFORE UPDATE ON sca_terms FOR EACH ROW EXECUTE FUNCTION sca_clear_marks_release_on_reopen();

ALTER TABLE sca_terms ADD CONSTRAINT sca_marks_release_closed_check
  CHECK (marks_released_at IS NULL OR status = 'closed');
