-- Module: people — student lifecycle (PDF 2.3 / SPPU ATKT ordinances).
-- A student is a lifecycle, not a row: widen the status check from the old
-- active/inactive to the full set. The record is never deleted — only moved
-- through these states (TC / marksheet / audit retention, ADR-0013).

ALTER TABLE ppl_students DROP CONSTRAINT ppl_students_status_check;
ALTER TABLE ppl_students ADD CONSTRAINT ppl_students_status_check
  CHECK (status IN ('active', 'inactive', 'backlog', 'year_back', 'transferred', 'dropped', 'alumni'));
