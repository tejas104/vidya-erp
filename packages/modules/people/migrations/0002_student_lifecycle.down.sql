-- Rollback of 0002. Any student in a lifecycle state the old check forbade
-- is mapped to 'inactive' first, so the narrower constraint can be restored.

ALTER TABLE ppl_students DROP CONSTRAINT ppl_students_status_check;
UPDATE ppl_students SET status = 'inactive' WHERE status NOT IN ('active', 'inactive');
ALTER TABLE ppl_students ADD CONSTRAINT ppl_students_status_check
  CHECK (status IN ('active', 'inactive'));
