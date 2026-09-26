-- A scoped term attendance review can be generated as PDF, Excel, or CSV.
ALTER TABLE rpt_reports DROP CONSTRAINT rpt_reports_kind_check;
ALTER TABLE rpt_reports ADD CONSTRAINT rpt_reports_kind_check
  CHECK (kind IN ('student-performance', 'section-attendance', 'marks-summary', 'at-risk', 'grade-card', 'hall-ticket', 'teacher-attendance', 'school-attendance-review'));
