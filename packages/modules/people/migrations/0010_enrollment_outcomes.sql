-- Module: people — year-end progression (N6, roadmap 1.5).
-- The outcome is recorded on the enrollment row it concludes. The row is never
-- deleted: promotion and detention complete it, an exit withdraws it, and the
-- next year's row (if any) is a new record. Transfer out and detention carry
-- the reason a certificate or review will need.

ALTER TABLE ppl_enrollments
  ADD COLUMN outcome text,
  ADD COLUMN outcome_reason text;

ALTER TABLE ppl_enrollments
  ADD CONSTRAINT ppl_enrollments_outcome_check CHECK (
    outcome IS NULL OR (ends_on IS NOT NULL AND CASE outcome
      WHEN 'promoted' THEN status = 'completed'
      WHEN 'graduated' THEN status = 'completed'
      WHEN 'detained' THEN status = 'completed' AND outcome_reason IS NOT NULL
      WHEN 'transferred_out' THEN status = 'withdrawn' AND outcome_reason IS NOT NULL
      ELSE false
    END)
  ),
  ADD CONSTRAINT ppl_enrollments_outcome_reason_check CHECK (
    outcome_reason IS NULL OR (outcome IS NOT NULL AND char_length(outcome_reason) BETWEEN 1 AND 240)
  );
