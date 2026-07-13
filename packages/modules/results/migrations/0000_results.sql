-- Vidya M5 (results): grade scales, subject credits, the publication gate.
CREATE TABLE res_grade_scales (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  name text NOT NULL,
  -- [{minPct, grade, points}] — tiles 0–100, validated at the contract edge
  bands jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX res_scales_name_uq ON res_grade_scales (college_id, name);

CREATE TABLE res_subject_credits (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  subject_id text NOT NULL,
  academic_year text NOT NULL,
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX res_credits_uq ON res_subject_credits (class_id, subject_id, academic_year);

CREATE TABLE res_publications (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  academic_year text NOT NULL,
  term text NOT NULL,
  -- RESTRICT: a published scale is frozen — published SGPA stays reproducible
  scale_id text NOT NULL REFERENCES res_grade_scales(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by text NOT NULL
);
CREATE UNIQUE INDEX res_publications_uq ON res_publications (class_id, academic_year, term);
-- The portal read: publications of a student's class, newest first.
CREATE INDEX res_publications_class_idx ON res_publications (class_id, published_at DESC);
