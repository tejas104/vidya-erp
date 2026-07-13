-- Rollback of 0004: restore the pre-accountant shape check. Any existing
-- accountant grants must be removed first or this DDL fails (by design —
-- fail closed rather than orphan grants).
ALTER TABLE idn_scope_grants
  DROP CONSTRAINT idn_scope_grants_shape_check;
ALTER TABLE idn_scope_grants
  ADD CONSTRAINT idn_scope_grants_shape_check CHECK (
    (role = 'teacher' AND subject_id IS NOT NULL AND class_id IS NOT NULL)
    OR (role = 'class_teacher' AND subject_id IS NULL AND class_id IS NOT NULL)
    OR (role = 'hod' AND subject_id IS NULL AND department_id IS NOT NULL
        AND class_id IS NULL AND section_id IS NULL)
    OR (role IN ('principal', 'admin') AND subject_id IS NULL
        AND department_id IS NULL AND class_id IS NULL AND section_id IS NULL)
  );
