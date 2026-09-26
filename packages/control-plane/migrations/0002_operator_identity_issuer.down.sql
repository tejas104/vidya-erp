DROP INDEX IF EXISTS cp_operators_issuer_subject;
ALTER TABLE cp_operators ADD CONSTRAINT cp_operators_identity_subject_key UNIQUE (identity_subject);
ALTER TABLE cp_operators DROP CONSTRAINT cp_operators_identity_issuer_valid;
ALTER TABLE cp_operators DROP COLUMN identity_issuer;
