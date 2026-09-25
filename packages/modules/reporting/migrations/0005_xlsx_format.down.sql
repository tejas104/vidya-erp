-- Keep generated Excel requests intact. Rollback requires exporting/removing
-- those report rows first; do not silently discard their audit trail.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM rpt_reports WHERE format = 'xlsx') THEN
    RAISE EXCEPTION 'Cannot roll back XLSX format while Excel report rows exist';
  END IF;
END $$;
ALTER TABLE rpt_reports DROP CONSTRAINT rpt_reports_format_check;
ALTER TABLE rpt_reports ADD CONSTRAINT rpt_reports_format_check
  CHECK (format IN ('pdf', 'csv'));
