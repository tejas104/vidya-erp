-- Certificate numbers are serialized per school and academic year by an
-- advisory transaction lock before INSERT. The unique keys remain the final
-- integrity boundary. A failed issuance rolls back its number and audit.
CREATE TABLE rpt_school_certificates (
  id TEXT PRIMARY KEY,
  college_id TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  number TEXT NOT NULL,
  student_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bonafide', 'transfer')),
  payload JSONB NOT NULL,
  correction_of_id TEXT,
  request_id TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT rpt_school_certificates_school_id_key UNIQUE (college_id, id),
  CONSTRAINT rpt_school_certificates_number_key UNIQUE (college_id, number),
  CONSTRAINT rpt_school_certificates_sequence_key UNIQUE (college_id, academic_year, sequence),
  CONSTRAINT rpt_school_certificates_request_key UNIQUE (college_id, request_id),
  CONSTRAINT rpt_school_certificates_correction_key UNIQUE (college_id, correction_of_id),
  CONSTRAINT rpt_school_certificates_correction_fk FOREIGN KEY (college_id, correction_of_id)
    REFERENCES rpt_school_certificates (college_id, id) ON DELETE RESTRICT
);
CREATE INDEX rpt_school_certificates_student_idx
  ON rpt_school_certificates (student_id, issued_at DESC);

CREATE FUNCTION rpt_school_certificates_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'school certificates are append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rpt_school_certificates_no_update BEFORE UPDATE OR DELETE ON rpt_school_certificates
  FOR EACH ROW EXECUTE FUNCTION rpt_school_certificates_immutable();
