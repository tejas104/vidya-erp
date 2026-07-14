-- Module: academics — subject-teacher attendance (ADR-0010 revision).
-- Attendance stops being a class-teacher-only, non-subject record: each
-- subject teacher marks their own period. subject_id = '' keeps the old
-- whole-section (class-teacher) session; a non-empty subject_id makes the
-- row a SUBJECT record scoped to that subject's teacher. The uniqueness key
-- gains subject_id so a section/date/slot can hold one session per subject.

ALTER TABLE acd_attendance_sessions ADD COLUMN subject_id text NOT NULL DEFAULT '';

DROP INDEX acd_sessions_unique_idx;
CREATE UNIQUE INDEX acd_sessions_unique_idx
  ON acd_attendance_sessions (section_id, held_on, slot, subject_id);
