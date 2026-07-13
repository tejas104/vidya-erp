-- Vidya M7 (leave): the staff-leave register.
CREATE TABLE lvs_requests (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  department_id text,                       -- null = college-level (principal-decided)
  teacher_id text NOT NULL,
  from_on text NOT NULL,
  to_on text NOT NULL,
  kind text NOT NULL,                       -- casual | sick | duty
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lvs_requests_window_check CHECK (to_on >= from_on)
);
CREATE INDEX lvs_requests_teacher_idx ON lvs_requests (teacher_id);
CREATE INDEX lvs_requests_college_status_idx ON lvs_requests (college_id, status);
CREATE INDEX lvs_requests_dept_status_idx ON lvs_requests (department_id, status);
