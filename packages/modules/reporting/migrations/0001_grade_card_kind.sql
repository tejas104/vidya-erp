-- M5 (results): the grade-card report kind joins the catalog.
ALTER TABLE rpt_reports DROP CONSTRAINT rpt_reports_kind_check;
ALTER TABLE rpt_reports ADD CONSTRAINT rpt_reports_kind_check
  CHECK (kind IN ('student-performance', 'section-attendance', 'marks-summary', 'at-risk', 'grade-card'));
