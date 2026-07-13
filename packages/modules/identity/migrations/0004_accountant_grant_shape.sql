-- Vidya M4 (fees), fix: 0003 admitted the 'accountant' role but left the
-- grant SHAPE check untouched, so the accountant's college-wide grant
-- (same shape as principal/admin) was rejected by the database. Rebuild
-- the shape check with accountant in the college-wide arm.
ALTER TABLE idn_scope_grants
  DROP CONSTRAINT idn_scope_grants_shape_check;
ALTER TABLE idn_scope_grants
  ADD CONSTRAINT idn_scope_grants_shape_check CHECK (
    (role = 'teacher' AND subject_id IS NOT NULL AND class_id IS NOT NULL)
    OR (role = 'class_teacher' AND subject_id IS NULL AND class_id IS NOT NULL)
    OR (role = 'hod' AND subject_id IS NULL AND department_id IS NOT NULL
        AND class_id IS NULL AND section_id IS NULL)
    OR (role IN ('principal', 'admin', 'accountant') AND subject_id IS NULL
        AND department_id IS NULL AND class_id IS NULL AND section_id IS NULL)
  );
