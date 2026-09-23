-- Immutable school report-card snapshots.
--
-- A snapshot is the permanent record of what a report card said when it was
-- issued. Regenerating creates a NEW row; the superseded row is never updated
-- and never deleted, so reprinting an old report card reproduces the original
-- document even after marks are corrected.
--
-- Immutability is enforced HERE, at the database boundary, rather than trusted
-- to application code declining to issue an UPDATE.

CREATE TABLE rpt_school_report_cards (
  id              TEXT PRIMARY KEY,
  student_id      TEXT        NOT NULL,
  term_id         TEXT        NOT NULL,
  academic_year   TEXT        NOT NULL,
  college_id      TEXT        NOT NULL,
  department_id   TEXT        NOT NULL,
  class_id        TEXT        NOT NULL,
  section_id      TEXT,
  payload         JSONB       NOT NULL,
  generated_by    TEXT        NOT NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rpt_school_report_cards_student_term_idx
  ON rpt_school_report_cards (student_id, term_id, generated_at);
CREATE INDEX rpt_school_report_cards_class_term_idx
  ON rpt_school_report_cards (class_id, term_id);

-- An issued report card is a historical fact. Blocking UPDATE and DELETE in
-- the database means an application bug, an ad-hoc psql session or a future
-- module cannot silently rewrite a document a family already holds.
CREATE OR REPLACE FUNCTION rpt_school_report_cards_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'rpt_school_report_cards is append-only: generate a new snapshot instead of %ing %',
    lower(TG_OP), OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rpt_school_report_cards_no_update
  BEFORE UPDATE ON rpt_school_report_cards
  FOR EACH ROW EXECUTE FUNCTION rpt_school_report_cards_immutable();

CREATE TRIGGER rpt_school_report_cards_no_delete
  BEFORE DELETE ON rpt_school_report_cards
  FOR EACH ROW EXECUTE FUNCTION rpt_school_report_cards_immutable();
