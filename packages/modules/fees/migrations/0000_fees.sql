-- Vidya fees (fee_): heads, per-class structures, invoices, payments,
-- adjustments. Money is integer PAISE everywhere — never floats. Org-path
-- columns are stamped on every invoice at generation time (denormalized,
-- validated against the PeopleDirectory) — the academics/timetable pattern:
-- scope checks never need cross-module lookups.

CREATE TABLE fee_heads (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_heads_uq UNIQUE (college_id, name)
);

CREATE TABLE fee_structures (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  head_id text NOT NULL REFERENCES fee_heads (id),
  academic_year text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  due_on date NOT NULL,
  installment_no integer NOT NULL DEFAULT 1 CHECK (installment_no >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_structures_uq UNIQUE (class_id, head_id, academic_year, installment_no)
);
CREATE INDEX fee_structures_class_idx ON fee_structures (class_id, academic_year);

-- One invoice per (student, structure): re-running "generate" for a class is
-- idempotent (ON CONFLICT DO NOTHING on this key).
CREATE TABLE fee_invoices (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  section_id text NOT NULL,
  student_id text NOT NULL,
  structure_id text NOT NULL REFERENCES fee_structures (id),
  head_id text NOT NULL,
  academic_year text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'part', 'paid', 'waived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_invoices_uq UNIQUE (student_id, structure_id)
);
CREATE INDEX fee_invoices_student_idx ON fee_invoices (student_id, academic_year);
CREATE INDEX fee_invoices_section_idx ON fee_invoices (section_id, academic_year);
CREATE INDEX fee_invoices_college_idx ON fee_invoices (college_id, academic_year, status);

-- Receipt numbers are monotonic PER COLLEGE, issued from fee_receipt_counters
-- inside the same transaction as the payment insert (UPDATE ... RETURNING on
-- a single row serializes concurrent issuers — no raw sequence needed, and
-- the increment is a pure, unit-testable function — see src/money.ts).
CREATE TABLE fee_receipt_counters (
  college_id text PRIMARY KEY,
  last_issued integer NOT NULL DEFAULT 0
);

CREATE TABLE fee_payments (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES fee_invoices (id),
  college_id text NOT NULL,
  receipt_no integer NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'bank', 'gateway')),
  ref text NOT NULL DEFAULT '',
  received_by text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_payments_receipt_uq UNIQUE (college_id, receipt_no)
);
CREATE INDEX fee_payments_invoice_idx ON fee_payments (invoice_id);
CREATE INDEX fee_payments_college_date_idx ON fee_payments (college_id, received_at);

CREATE TABLE fee_adjustments (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES fee_invoices (id),
  college_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('scholarship', 'fine', 'refund', 'waiver')),
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fee_adjustments_invoice_idx ON fee_adjustments (invoice_id);

-- Bulk invoice generation (worker job) tracking — mirrors ppl_imports so the
-- admin UI can poll a run the same way it polls a CSV import.
CREATE TABLE fee_generation_runs (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  class_id text NOT NULL,
  academic_year text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  invoices_created integer NOT NULL DEFAULT 0,
  invoices_skipped integer NOT NULL DEFAULT 0,
  error text,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX fee_generation_runs_class_idx ON fee_generation_runs (class_id, academic_year);
