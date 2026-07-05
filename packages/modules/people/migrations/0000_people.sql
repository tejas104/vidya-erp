-- Module: people (table prefix: ppl_)
-- The canonical org tree, student/teacher records, enrollment, teacher
-- assignments (source of truth for derived identity grants, ADR-0015),
-- and bulk-import bookkeeping. teacher.identity_user_id is an OPAQUE
-- cross-module reference to the identity module — deliberately no FK
-- (Constitution rule 2).

CREATE TABLE ppl_colleges (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_colleges_code_idx ON ppl_colleges (code);

CREATE TABLE ppl_departments (
  id text PRIMARY KEY,
  college_id text NOT NULL REFERENCES ppl_colleges (id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_departments_code_idx ON ppl_departments (college_id, code);

CREATE TABLE ppl_classes (
  id text PRIMARY KEY,
  department_id text NOT NULL REFERENCES ppl_departments (id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_classes_code_idx ON ppl_classes (department_id, code);

CREATE TABLE ppl_sections (
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES ppl_classes (id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_sections_name_idx ON ppl_sections (class_id, name);

CREATE TABLE ppl_subjects (
  id text PRIMARY KEY,
  department_id text NOT NULL REFERENCES ppl_departments (id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_subjects_code_idx ON ppl_subjects (department_id, code);

CREATE TABLE ppl_students (
  id text PRIMARY KEY,
  college_id text NOT NULL REFERENCES ppl_colleges (id) ON DELETE RESTRICT,
  admission_no text NOT NULL,
  full_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT ppl_students_status_check CHECK (status IN ('active', 'inactive')),
  source_import_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_students_admission_idx ON ppl_students (college_id, admission_no);

CREATE TABLE ppl_teachers (
  id text PRIMARY KEY,
  college_id text NOT NULL REFERENCES ppl_colleges (id) ON DELETE RESTRICT,
  staff_no text NOT NULL,
  full_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT ppl_teachers_status_check CHECK (status IN ('active', 'inactive')),
  identity_user_id text,
  source_import_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_teachers_staff_idx ON ppl_teachers (college_id, staff_no);
CREATE INDEX ppl_teachers_identity_idx ON ppl_teachers (identity_user_id);

CREATE TABLE ppl_enrollments (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES ppl_students (id) ON DELETE CASCADE,
  section_id text NOT NULL REFERENCES ppl_sections (id) ON DELETE RESTRICT,
  academic_year text NOT NULL,
  status text NOT NULL DEFAULT 'enrolled'
    CONSTRAINT ppl_enrollments_status_check CHECK (status IN ('enrolled', 'withdrawn', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ppl_enrollments_section_idx ON ppl_enrollments (section_id);
CREATE INDEX ppl_enrollments_student_idx ON ppl_enrollments (student_id);
-- One live enrollment per student per academic year.
CREATE UNIQUE INDEX ppl_enrollments_active_idx
  ON ppl_enrollments (student_id, academic_year)
  WHERE status = 'enrolled';

CREATE TABLE ppl_teacher_assignments (
  id text PRIMARY KEY,
  teacher_id text NOT NULL REFERENCES ppl_teachers (id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES ppl_classes (id) ON DELETE RESTRICT,
  subject_id text REFERENCES ppl_subjects (id) ON DELETE RESTRICT,
  kind text NOT NULL
    CONSTRAINT ppl_assignments_kind_check CHECK (kind IN ('subject_teacher', 'class_teacher')),
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Per the approved model: subject teachers carry a subject, class
  -- teachers do not (mirrors the identity module's grant-shape checks).
  CONSTRAINT ppl_assignments_shape_check CHECK (
    (kind = 'subject_teacher' AND subject_id IS NOT NULL)
    OR (kind = 'class_teacher' AND subject_id IS NULL)
  )
);
CREATE INDEX ppl_assignments_teacher_idx ON ppl_teacher_assignments (teacher_id);
CREATE INDEX ppl_assignments_class_idx ON ppl_teacher_assignments (class_id);
-- One subject-teacher per (class, subject, year); one class-teacher
-- assignment per (teacher, class, year).
CREATE UNIQUE INDEX ppl_assignments_subject_unique_idx
  ON ppl_teacher_assignments (class_id, subject_id, academic_year)
  WHERE kind = 'subject_teacher';
CREATE UNIQUE INDEX ppl_assignments_classteacher_unique_idx
  ON ppl_teacher_assignments (teacher_id, class_id, academic_year)
  WHERE kind = 'class_teacher';

CREATE TABLE ppl_imports (
  id text PRIMARY KEY,
  kind text NOT NULL
    CONSTRAINT ppl_imports_kind_check CHECK (kind IN ('students', 'teachers')),
  college_id text NOT NULL REFERENCES ppl_colleges (id) ON DELETE RESTRICT,
  academic_year text,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT ppl_imports_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  dry_run boolean NOT NULL DEFAULT false,
  object_key text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  ok_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

COMMENT ON TABLE ppl_teacher_assignments IS
  'Source of truth for derived identity grants (ADR-0015): each row materializes as one identity-module scope grant with source=derived.';
