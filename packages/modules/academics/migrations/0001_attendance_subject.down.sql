-- Rollback of 0001. Restores the section/date/slot uniqueness. Any two
-- rows that differ only by subject_id would now collide — back up first.

DROP INDEX acd_sessions_unique_idx;
CREATE UNIQUE INDEX acd_sessions_unique_idx
  ON acd_attendance_sessions (section_id, held_on, slot);

ALTER TABLE acd_attendance_sessions DROP COLUMN subject_id;
