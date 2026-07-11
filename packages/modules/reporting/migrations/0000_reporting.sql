-- Module: reporting (table prefix: rpt_)
-- Bookkeeping for generated report artifacts. The artifact (PDF/CSV) lives
-- in MinIO; only its metadata is here. Access control is the scoped-download
-- re-check (requested_by + a fresh scope check, ADR-0020) — NOT the object
-- key, which is a random UUID but never the access boundary.

CREATE TABLE rpt_reports (
  id text PRIMARY KEY,
  kind text NOT NULL
    CONSTRAINT rpt_reports_kind_check
    CHECK (kind IN ('student-performance', 'section-attendance', 'marks-summary', 'at-risk')),
  format text NOT NULL
    CONSTRAINT rpt_reports_format_check CHECK (format IN ('pdf', 'csv')),
  params jsonb NOT NULL,
  academic_year text NOT NULL,
  -- Requester's scope snapshot (roles + grants) at request time: the worker
  -- generates with THIS scope; download re-checks the CURRENT scope.
  requester_principal jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT rpt_reports_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  object_key text,
  rows integer NOT NULL DEFAULT 0,
  error text,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX rpt_reports_requester_idx ON rpt_reports (requested_by, created_at);

COMMENT ON TABLE rpt_reports IS
  'Report artifacts (ADR-0020): a report is a disclosure surface built through the analytics read model (scope-filtered + minimum-cohort). Downloads are re-scope-checked; the object key is not access control.';
