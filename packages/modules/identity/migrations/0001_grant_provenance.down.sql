-- Rollback of 0001_grant_provenance. Derived grants lose their provenance
-- tagging but remain valid grants; re-applying the migration and running
-- the people-module reconciliation job restores tagging.

ALTER TABLE idn_scope_grants
  DROP CONSTRAINT idn_scope_grants_source_ref_shape_check;
DROP INDEX idn_scope_grants_source_ref_idx;
ALTER TABLE idn_scope_grants
  DROP COLUMN source_ref,
  DROP COLUMN source;
