-- Module: syllabus — units + topics with per-topic coverage (taught_on date).
CREATE TABLE syl_units (
  id            text PRIMARY KEY,
  college_id    text NOT NULL,
  department_id text NOT NULL,
  class_id      text NOT NULL,
  subject_id    text NOT NULL,
  teacher_id    text NOT NULL,
  academic_year text NOT NULL,
  title         text NOT NULL,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX syl_unit_title_uq ON syl_units (class_id, subject_id, academic_year, title);
CREATE INDEX syl_unit_class_idx ON syl_units (class_id, academic_year);

CREATE TABLE syl_topics (
  id         text PRIMARY KEY,
  unit_id    text NOT NULL,
  title      text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  taught_on  date,
  taught_by  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX syl_topic_unit_idx ON syl_topics (unit_id);
