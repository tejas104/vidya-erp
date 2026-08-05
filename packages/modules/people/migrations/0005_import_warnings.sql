-- Module: people — import warning tier + progress counters (#11 Task A2).
-- A warning is a row that imports successfully with a caveat (v1: a student
-- created unassigned because the optional enrollment trio was blank).
-- processed_rows lets a running job report progress before it finishes.

ALTER TABLE ppl_imports ADD COLUMN warning_rows integer NOT NULL DEFAULT 0;
ALTER TABLE ppl_imports ADD COLUMN processed_rows integer NOT NULL DEFAULT 0;
ALTER TABLE ppl_imports ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]';
