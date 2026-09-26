-- Existing operators have no trustworthy issuer binding and cannot sign in.
-- A selected OIDC provider must explicitly bind each named operator again.
ALTER TABLE cp_operators ADD COLUMN identity_issuer text;
ALTER TABLE cp_operators ADD CONSTRAINT cp_operators_identity_issuer_valid
  CHECK (identity_issuer IS NULL OR (length(identity_issuer) BETWEEN 8 AND 255 AND identity_issuer ~ '^https://'));
ALTER TABLE cp_operators DROP CONSTRAINT cp_operators_identity_subject_key;
CREATE UNIQUE INDEX cp_operators_issuer_subject ON cp_operators (identity_issuer, identity_subject)
  WHERE identity_issuer IS NOT NULL;
