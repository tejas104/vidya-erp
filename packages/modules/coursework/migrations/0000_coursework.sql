-- Vidya coursework (cwk_): assignments, submissions, study materials.
-- Org-path columns per row for scope checks (academics pattern).
CREATE TABLE cwk_assignments (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  teacher_id text NOT NULL,
  title text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  due_on text NOT NULL,           -- YYYY-MM-DD
  max_score numeric(7,2),
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cwk_assignment_title_uq UNIQUE (class_id, subject_id, academic_year, title)
);
CREATE INDEX cwk_assignments_class_idx ON cwk_assignments (class_id, academic_year);

CREATE TABLE cwk_submissions (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES cwk_assignments(id) ON DELETE RESTRICT,
  student_id text NOT NULL,
  body text NOT NULL DEFAULT '',
  object_key text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  score numeric(7,2),
  feedback text,
  evaluated_by text,
  evaluated_at timestamptz,
  CONSTRAINT cwk_submission_uq UNIQUE (assignment_id, student_id)
);
CREATE INDEX cwk_submissions_student_idx ON cwk_submissions (student_id);

CREATE TABLE cwk_materials (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  teacher_id text NOT NULL,
  title text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cwk_materials_class_idx ON cwk_materials (class_id, academic_year);
