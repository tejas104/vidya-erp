-- Rollback of 0000_people. Destroys the org tree, all people records,
-- enrollment, assignments and import bookkeeping — back up first in any
-- shared environment (docs/runbook.md#rollback). Derived identity grants
-- become orphans; run the people reconciliation job after re-applying, or
-- remove them via the identity admin API.

DROP TABLE ppl_imports;
DROP TABLE ppl_teacher_assignments;
DROP TABLE ppl_enrollments;
DROP TABLE ppl_teachers;
DROP TABLE ppl_students;
DROP TABLE ppl_subjects;
DROP TABLE ppl_sections;
DROP TABLE ppl_classes;
DROP TABLE ppl_departments;
DROP TABLE ppl_colleges;
