-- ADR-0027: a guardian (parent or other linked adult) signs in through the
-- same session machinery as staff, but is a different kind of principal.
-- The account kind lives here, with the account, so the authenticator can
-- tell a guardian from a role-less staff account without reading another
-- module's tables. Guardian accounts never hold roles or scope grants; the
-- service refuses to add either (see UsersService).
ALTER TABLE idn_users
  ADD COLUMN account_kind text NOT NULL DEFAULT 'staff'
  CONSTRAINT idn_users_account_kind_check CHECK (account_kind IN ('staff', 'guardian'));
