-- Vidya M4 (fees): admit the 'accountant' role.
-- Accountants hold a college-wide grant (like principal/admin) — see
-- grantInputSchema and grantAllows: read/export college-wide, write
-- (create/update) restricted to resource.module = 'fees'.
ALTER TABLE idn_user_roles
  DROP CONSTRAINT idn_user_roles_role_check;
ALTER TABLE idn_user_roles
  ADD CONSTRAINT idn_user_roles_role_check
  CHECK (role IN ('admin', 'principal', 'hod', 'class_teacher', 'teacher', 'student', 'accountant'));
