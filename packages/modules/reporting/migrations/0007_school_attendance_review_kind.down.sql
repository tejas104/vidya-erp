-- Keep generated artifacts and their audit metadata; never discard rows on rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM rpt_reports WHERE kind = 'school-attendance-review') THEN
    RAISE EXCEPTION 'Cannot roll back school attendance review reports while their rows exist';
  END IF;
END $$;
ALTER TABLE rpt_reports DROP CONSTRAINT rpt_reports_kind_check;
ALTER TABLE rpt_reports ADD CONSTRAINT rpt_reports_kind_check
  CHECK (kind IN ('student-performance', 'section-attendance', 'marks-summary', 'at-risk', 'grade-card', 'hall-ticket', 'teacher-attendance'));
