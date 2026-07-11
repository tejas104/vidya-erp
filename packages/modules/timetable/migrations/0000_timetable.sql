-- Vidya timetable (ttb_): fixed-period weekly schedules.
-- Clash detection is the DATABASE: a section, a teacher and a (non-empty)
-- room can each hold exactly one entry per (day, period, year). Org-path
-- columns are stored per entry for scope checks (the academics pattern).

CREATE TABLE ttb_periods (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  period_no integer NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  starts text NOT NULL,  -- "09:00" (display-timezone-free wall time)
  ends text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ttb_periods_uq UNIQUE (college_id, period_no)
);

CREATE TABLE ttb_entries (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  section_id text NOT NULL,
  subject_id text NOT NULL,
  teacher_id text NOT NULL,
  room text NOT NULL DEFAULT '',
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  period_no integer NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ttb_section_slot_uq UNIQUE (section_id, academic_year, day_of_week, period_no),
  CONSTRAINT ttb_teacher_slot_uq UNIQUE (teacher_id, academic_year, day_of_week, period_no)
);

CREATE UNIQUE INDEX ttb_room_slot_uq
  ON ttb_entries (college_id, academic_year, day_of_week, period_no, room)
  WHERE room <> '';
CREATE INDEX ttb_entries_teacher_idx ON ttb_entries (teacher_id, academic_year);
CREATE INDEX ttb_entries_section_idx ON ttb_entries (section_id, academic_year);
