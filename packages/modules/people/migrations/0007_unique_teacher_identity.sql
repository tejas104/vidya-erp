-- One identity account must not be linked to two teacher records. The API
-- checks first for a useful 409, and this index closes concurrent races.
-- An existing duplicate blocks the migration so an operator can resolve it
-- explicitly; the runner rolls this entire migration back on failure.
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ppl_teachers
    WHERE identity_user_id IS NOT NULL
    GROUP BY identity_user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate teacher identity links exist; resolve them before applying people/0007';
  END IF;
END $$;

DROP INDEX ppl_teachers_identity_idx;
CREATE UNIQUE INDEX ppl_teachers_identity_idx ON ppl_teachers (identity_user_id);
