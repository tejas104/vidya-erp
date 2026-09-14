-- Module: school-academics (table prefix: sca_). SCHOOL EDITION ONLY —
-- ModuleDefinition.editions is ["school"], so a college install never
-- registers the module and never runs this migration's tables in anger.
--
-- The term entity: assignment #14's foundation slice. Assessments, marks
-- and report cards are NOT here.
--
-- college_id / department_id are OPAQUE cross-module references to the
-- people module — no foreign keys (Constitution rule 2). They are resolved
-- through the PeopleDirectory at create time and DENORMALIZED here so every
-- row carries its own org position for scope checks (ADR-0017), exactly as
-- the academics module's assessment table does. department_id is the ONE
-- implicit department a school's org tree hangs off (ADR-0023); a school
-- has no department level,
-- so this column is never rendered or accepted by the API.
CREATE TABLE sca_terms (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  name text NOT NULL,
  academic_year text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT sca_terms_status_check
    CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by text,
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sca_terms_window_check CHECK (ends_on >= starts_on)
);

-- One school cannot have two terms with the same name in the same year.
CREATE UNIQUE INDEX sca_terms_unique_idx ON sca_terms (college_id, academic_year, name);
CREATE INDEX sca_terms_college_year_idx ON sca_terms (college_id, academic_year);

COMMENT ON COLUMN sca_terms.closed_at IS
  'Time of the most recent status change (close or reopen).';
COMMENT ON COLUMN sca_terms.closed_by IS
  'Principal id behind the most recent status change.';
COMMENT ON COLUMN sca_terms.closed_reason IS
  'Reason recorded with the most recent status change: optional on close, MANDATORY on reopen. The authoritative trail is the append-only audit log (school-academics.closed / school-academics.reopened); this column is the current-state copy so the UI need not join it.';
