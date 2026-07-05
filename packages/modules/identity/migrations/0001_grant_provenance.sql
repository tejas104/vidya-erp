-- Module: identity (table prefix: idn_)
-- Grant provenance for Vidya #3 (ADR-0015): grants derived from people-
-- module teacher assignments are tagged with their source so derivation is
-- idempotent, reconcilable, and never collides with manual administration.

ALTER TABLE idn_scope_grants
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
    CONSTRAINT idn_scope_grants_source_check CHECK (source IN ('manual', 'derived')),
  ADD COLUMN source_ref text;

-- One derived grant per source (e.g. one per teacher assignment).
CREATE UNIQUE INDEX idn_scope_grants_source_ref_idx
  ON idn_scope_grants (source_ref)
  WHERE source_ref IS NOT NULL;

-- Derived rows must carry their source reference; manual rows must not.
ALTER TABLE idn_scope_grants
  ADD CONSTRAINT idn_scope_grants_source_ref_shape_check CHECK (
    (source = 'derived' AND source_ref IS NOT NULL)
    OR (source = 'manual' AND source_ref IS NULL)
  );
