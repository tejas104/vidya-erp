-- Family release decisions are independent of immutable report-card content.
CREATE TABLE rpt_school_report_card_publications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  snapshot_id TEXT REFERENCES rpt_school_report_cards(id),
  action TEXT NOT NULL CHECK (action IN ('published', 'withdrawn')),
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rpt_rc_publication_shape CHECK (
    (action = 'published' AND snapshot_id IS NOT NULL) OR
    (action = 'withdrawn' AND snapshot_id IS NULL)
  )
);
CREATE INDEX rpt_rc_publications_student_term_idx
  ON rpt_school_report_card_publications (student_id, term_id, id);

-- The decision trail is evidence, so only new events may be appended.
CREATE FUNCTION rpt_publication_event_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'rpt_school_report_card_publications is append-only'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rpt_rc_publications_no_update
  BEFORE UPDATE ON rpt_school_report_card_publications
  FOR EACH ROW EXECUTE FUNCTION rpt_publication_event_immutable();
CREATE TRIGGER rpt_rc_publications_no_delete
  BEFORE DELETE ON rpt_school_report_card_publications
  FOR EACH ROW EXECUTE FUNCTION rpt_publication_event_immutable();
