-- Module: academics (table prefix: acd_)
-- Attendance sessions/entries and assessments/marks. Cross-module ids
-- (section/class/subject/student/college/department) are OPAQUE references
-- to the people module — no foreign keys (Constitution rule 2); they are
-- validated via the PeopleDirectory at write time and denormalized here so
-- each record carries its own org position for scope checks (ADR-0017).
--
-- The load-bearing distinction of the permission matrix: attendance rows
-- have NO subject column (non-subject records); marks always inherit their
-- assessment's subject_id (subject records).

CREATE TABLE acd_attendance_sessions (
  id text PRIMARY KEY,
  section_id text NOT NULL,
  held_on date NOT NULL,
  slot text NOT NULL DEFAULT 'day',
  academic_year text NOT NULL,
  taken_by text NOT NULL,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX acd_sessions_unique_idx ON acd_attendance_sessions (section_id, held_on, slot);
CREATE INDEX acd_sessions_section_idx ON acd_attendance_sessions (section_id, held_on);
CREATE INDEX acd_sessions_date_idx ON acd_attendance_sessions (held_on);

CREATE TABLE acd_attendance_entries (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES acd_attendance_sessions (id) ON DELETE CASCADE,
  student_id text NOT NULL,
  status text NOT NULL
    CONSTRAINT acd_entries_status_check
    CHECK (status IN ('present', 'absent', 'late', 'excused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX acd_entries_unique_idx ON acd_attendance_entries (session_id, student_id);
CREATE INDEX acd_entries_student_idx ON acd_attendance_entries (student_id);

CREATE TABLE acd_assessments (
  id text PRIMARY KEY,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  kind text NOT NULL
    CONSTRAINT acd_assessments_kind_check
    CHECK (kind IN ('exam', 'quiz', 'assignment')),
  name text NOT NULL,
  academic_year text NOT NULL,
  max_score numeric(6, 2) NOT NULL
    CONSTRAINT acd_assessments_max_score_check CHECK (max_score > 0),
  held_on date,
  college_id text NOT NULL,
  department_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX acd_assessments_unique_idx
  ON acd_assessments (class_id, subject_id, academic_year, name);
CREATE INDEX acd_assessments_class_idx ON acd_assessments (class_id);

CREATE TABLE acd_marks (
  id text PRIMARY KEY,
  -- RESTRICT: an assessment with marks cannot be deleted (409 at the API).
  assessment_id text NOT NULL REFERENCES acd_assessments (id) ON DELETE RESTRICT,
  student_id text NOT NULL,
  score numeric(6, 2) NOT NULL
    CONSTRAINT acd_marks_score_check CHECK (score >= 0),
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX acd_marks_unique_idx ON acd_marks (assessment_id, student_id);
CREATE INDEX acd_marks_student_idx ON acd_marks (student_id);

COMMENT ON TABLE acd_marks IS
  'Current marks; the complete change history (who/when/old/new) lives in the append-only audit log (grade-change integrity, ADR-0017). score <= max_score is enforced in the service layer (cross-table).';
