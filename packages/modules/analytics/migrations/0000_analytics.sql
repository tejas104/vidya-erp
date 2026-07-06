-- Module: analytics (table prefix: anl_)
-- Precomputed rollups + at-risk flags, rebuilt nightly from the academics
-- module's PUBLIC read model (never its tables). Rows carry the org
-- position of the node they summarize so the serving layer can run the
-- constituent-closure checks of ADR-0018 against the row itself. Storage
-- is not disclosure: computation is blind, serving is scope-checked.

CREATE TABLE anl_attendance_rollups (
  id text PRIMARY KEY,
  scope_level text NOT NULL
    CONSTRAINT anl_att_level_check CHECK (scope_level IN ('section', 'class', 'department', 'college')),
  node_id text NOT NULL,
  college_id text NOT NULL,
  department_id text,
  class_id text,
  section_id text,
  academic_year text NOT NULL,
  period text NOT NULL,
  sessions integer NOT NULL,
  present integer NOT NULL,
  absent integer NOT NULL,
  late integer NOT NULL,
  excused integer NOT NULL,
  distinct_students integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX anl_att_rollups_unique_idx
  ON anl_attendance_rollups (node_id, academic_year, period);
CREATE INDEX anl_att_rollups_year_idx ON anl_attendance_rollups (academic_year);

CREATE TABLE anl_marks_rollups (
  id text PRIMARY KEY,
  scope_level text NOT NULL
    CONSTRAINT anl_marks_level_check CHECK (scope_level IN ('class', 'department', 'college')),
  node_id text NOT NULL,
  college_id text NOT NULL,
  department_id text,
  class_id text,
  academic_year text NOT NULL,
  period text NOT NULL,
  -- NULL subject_id = cross-subject aggregate; `subjects` then lists every
  -- constituent subject for the explicit closure check (ADR-0018).
  subject_id text,
  subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  avg_pct numeric(5, 2) NOT NULL,
  n_marks integer NOT NULL,
  distinct_students integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX anl_marks_rollups_unique_idx
  ON anl_marks_rollups (node_id, academic_year, period, subject_id) NULLS NOT DISTINCT;
CREATE INDEX anl_marks_rollups_year_idx ON anl_marks_rollups (academic_year);

CREATE TABLE anl_student_flags (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  academic_year text NOT NULL,
  college_id text NOT NULL,
  department_id text,
  class_id text,
  section_id text,
  attendance_pct numeric(5, 2),
  overall_pct numeric(5, 2),
  subject_pcts jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX anl_flags_unique_idx ON anl_student_flags (student_id, academic_year);
CREATE INDEX anl_flags_class_idx ON anl_student_flags (class_id, academic_year);
CREATE INDEX anl_flags_year_idx ON anl_student_flags (academic_year);

COMMENT ON TABLE anl_marks_rollups IS
  'Precomputed marks aggregates (ADR-0018). Cross-subject rows (subject_id IS NULL) are served only under explicit per-subject constituent closure; every aggregate is subject to the unconditional minimum-cohort rule.';
