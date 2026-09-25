-- Excel reports use the same scoped request, job, and download lifecycle.
ALTER TABLE rpt_reports DROP CONSTRAINT rpt_reports_format_check;
ALTER TABLE rpt_reports ADD CONSTRAINT rpt_reports_format_check
  CHECK (format IN ('pdf', 'csv', 'xlsx'));
