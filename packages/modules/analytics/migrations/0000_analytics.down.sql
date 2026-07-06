-- Rollback of 0000_analytics. Destroys only DERIVED data — the next
-- rollup-rebuild run regenerates everything from the academics module's
-- read model. No source records are affected.

DROP TABLE anl_student_flags;
DROP TABLE anl_marks_rollups;
DROP TABLE anl_attendance_rollups;
