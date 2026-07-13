-- Vidya M6 (exams): series + dated slots; the exam timetable on the noticeboard.
CREATE TABLE exm_series (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  name text NOT NULL,
  academic_year text NOT NULL,
  term text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX exm_series_name_uq ON exm_series (college_id, name, academic_year);

CREATE TABLE exm_slots (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  series_id text NOT NULL REFERENCES exm_series(id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  -- denormalized from the series so schedule reads never join
  academic_year text NOT NULL,
  on_date text NOT NULL,
  starts text NOT NULL,
  ends text NOT NULL,
  room text NOT NULL DEFAULT '',
  CONSTRAINT exm_slots_window_check CHECK (ends > starts)
);
CREATE UNIQUE INDEX exm_slots_paper_uq ON exm_slots (series_id, class_id, subject_id);
-- The schedule reads: a class's papers for a year, soonest first.
CREATE INDEX exm_slots_class_idx ON exm_slots (class_id, academic_year, on_date);
