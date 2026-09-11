-- Module: system (table prefix: sys_)
-- Monotonic high-water mark of the latest date this installation has ever
-- observed (licence design spec, DECISION 2 — the clock).
--
-- On-prem means the customer owns the clock, and setting it back would
-- silently rewind licence expiry. No signature scheme fixes that. Rather
-- than pretend otherwise, this makes regression DETECTABLE: if the wall
-- clock is ever earlier than this mark by more than a day, the boot path
-- audits it and evaluates the licence at the mark instead.
--
-- Deliberately NOT a lockout: a legitimate NTP correction or a timezone
-- change must never be able to take a college's information system down.
-- The one-day tolerance exists for exactly that.
--
-- Single-row by construction: id can only ever be true (CHECK), and it is
-- the primary key, so a second row is impossible.

CREATE TABLE sys_clock_watermark (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  observed_on date NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sys_clock_watermark IS
  'Single-row high-water mark of the latest date ever observed. Makes clock rollback auditable without ever blocking anyone (licence design spec, DECISION 2).';
