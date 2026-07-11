-- Vidya W1 (student portal): link a student record to an identity sign-in,
-- mirroring ppl_teachers.identity_user_id. The column is an OPAQUE identity
-- user id (no cross-module FK, per the module-boundary rule); the UNIQUE
-- partial index enforces one sign-in per student.
ALTER TABLE ppl_students
  ADD COLUMN identity_user_id text;
CREATE UNIQUE INDEX ppl_students_identity_uq
  ON ppl_students (identity_user_id)
  WHERE identity_user_id IS NOT NULL;
