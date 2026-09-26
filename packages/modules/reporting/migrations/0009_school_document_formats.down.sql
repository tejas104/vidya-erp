ALTER TABLE rpt_reports DROP COLUMN document_style;
ALTER TABLE rpt_school_report_cards DROP COLUMN document_style;
DROP TRIGGER rpt_school_document_formats_no_update ON rpt_school_document_formats;
DROP FUNCTION rpt_school_document_formats_immutable();
DROP TABLE rpt_school_document_formats;
