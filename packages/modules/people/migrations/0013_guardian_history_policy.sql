-- Each school's future exits use its configured read-only guardian window.
-- Issued exit dates remain stamped on the relationship and are never rewritten.
ALTER TABLE ppl_colleges
  ADD COLUMN guardian_history_days integer NOT NULL DEFAULT 90,
  ADD COLUMN guardian_history_version integer NOT NULL DEFAULT 1;
ALTER TABLE ppl_colleges ADD CONSTRAINT ppl_colleges_guardian_history_days_check
  CHECK (guardian_history_days BETWEEN 0 AND 365);
ALTER TABLE ppl_colleges ADD CONSTRAINT ppl_colleges_guardian_history_version_check
  CHECK (guardian_history_version > 0);
