-- Administrative staff presence, separate from pupils' academic attendance.
-- One dated record per teacher. Historical decisions survive deactivation.
CREATE TABLE ppl_teacher_attendance (
  id text PRIMARY KEY,
  college_id text NOT NULL REFERENCES ppl_colleges(id) ON DELETE RESTRICT,
  teacher_id text NOT NULL REFERENCES ppl_teachers(id) ON DELETE RESTRICT,
  attended_on date NOT NULL,
  status text NOT NULL CONSTRAINT ppl_teacher_attendance_status_check
    CHECK (status IN ('present', 'absent', 'late', 'leave')),
  note text CONSTRAINT ppl_teacher_attendance_note_length_check CHECK (note IS NULL OR char_length(note) <= 240),
  marked_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_teacher_attendance_day_idx ON ppl_teacher_attendance(teacher_id, attended_on);
CREATE INDEX ppl_teacher_attendance_college_day_idx ON ppl_teacher_attendance(college_id, attended_on);
