-- Down: restore the five-role check. The narrowed constraint rejects any
-- 'student' row, so remove those role assignments first — mirrors the
-- reporting down migrations, which delete rows a tightened CHECK would
-- reject before re-adding it. A rollback of the student-role feature
-- necessarily drops student role grants; the identity users and their
-- people links are untouched.
DELETE FROM idn_user_roles WHERE role = 'student';
ALTER TABLE idn_user_roles
  DROP CONSTRAINT idn_user_roles_role_check;
ALTER TABLE idn_user_roles
  ADD CONSTRAINT idn_user_roles_role_check
  CHECK (role IN ('admin', 'principal', 'hod', 'class_teacher', 'teacher'));
