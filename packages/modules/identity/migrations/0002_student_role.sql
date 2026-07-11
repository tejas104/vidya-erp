-- Vidya W1 (student portal): admit the 'student' role.
-- Students are SELF-SCOPED sign-ins: they hold the role but never scope
-- grants — record access flows through the people-module identity link
-- (ppl_students.identity_user_id), mirroring how teacher links work.
ALTER TABLE idn_user_roles
  DROP CONSTRAINT idn_user_roles_role_check;
ALTER TABLE idn_user_roles
  ADD CONSTRAINT idn_user_roles_role_check
  CHECK (role IN ('admin', 'principal', 'hod', 'class_teacher', 'teacher', 'student'));
