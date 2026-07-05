-- Rollback of 0000_academics. Destroys all attendance and marks data —
-- back up first in any shared environment (docs/runbook.md#rollback). The
-- audit trail of grade changes survives in the system module's append-only
-- audit table.

DROP TABLE acd_marks;
DROP TABLE acd_assessments;
DROP TABLE acd_attendance_entries;
DROP TABLE acd_attendance_sessions;
