-- Down: remove the student identity link.
DROP INDEX IF EXISTS ppl_students_identity_uq;
ALTER TABLE ppl_students
  DROP COLUMN IF EXISTS identity_user_id;
