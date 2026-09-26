-- Keep the applied outcome and the next-year row visible in history. A correction
-- records a new active placement; it never deletes an enrollment or audit event.
ALTER TABLE ppl_enrollments DROP CONSTRAINT ppl_enrollments_status_check;
ALTER TABLE ppl_enrollments ADD CONSTRAINT ppl_enrollments_status_check
  CHECK (status IN ('enrolled', 'withdrawn', 'completed', 'voided'));

CREATE TABLE ppl_progression_corrections (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES ppl_students(id) ON DELETE RESTRICT,
  source_enrollment_id text NOT NULL UNIQUE REFERENCES ppl_enrollments(id) ON DELETE RESTRICT,
  next_enrollment_id text REFERENCES ppl_enrollments(id) ON DELETE RESTRICT,
  reinstated_enrollment_id text NOT NULL UNIQUE REFERENCES ppl_enrollments(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ppl_progression_corrections_student_idx ON ppl_progression_corrections(student_id);
