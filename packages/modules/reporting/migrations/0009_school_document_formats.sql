-- Versioned, append-only school presentation choices. Uploaded samples are
-- reference material in private object storage; no uploaded file is executed
-- or used as a PDF template. The current format is the highest version.
CREATE TABLE rpt_school_document_formats (
  college_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('report_card', 'attendance_review', 'certificate')),
  version INTEGER NOT NULL CHECK (version > 0),
  style JSONB NOT NULL,
  sample_key TEXT,
  sample_filename TEXT,
  sample_content_type TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (college_id, family, version),
  CHECK ((sample_key IS NULL AND sample_filename IS NULL AND sample_content_type IS NULL)
      OR (sample_key IS NOT NULL AND sample_filename IS NOT NULL AND sample_content_type IS NOT NULL))
);
CREATE FUNCTION rpt_school_document_formats_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'school document format versions are append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rpt_school_document_formats_no_update BEFORE UPDATE OR DELETE ON rpt_school_document_formats
  FOR EACH ROW EXECUTE FUNCTION rpt_school_document_formats_immutable();

ALTER TABLE rpt_school_report_cards ADD COLUMN document_style JSONB;
ALTER TABLE rpt_reports ADD COLUMN document_style JSONB;
