-- Down: restore the five-role check (fails if any student role rows remain).
ALTER TABLE idn_user_roles
  DROP CONSTRAINT idn_user_roles_role_check;
ALTER TABLE idn_user_roles
  ADD CONSTRAINT idn_user_roles_role_check
  CHECK (role IN ('admin', 'principal', 'hod', 'class_teacher', 'teacher'));
