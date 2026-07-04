-- Rollback of 0000_identity. Destroys all user accounts, role memberships,
-- scope grants and reset tokens — back up first in any shared environment
-- (docs/runbook.md#rollback). Redis sessions become orphaned tokens that no
-- longer resolve (SessionManager.resolve returns null for unknown users).

DROP TABLE idn_reset_tokens;
DROP TABLE idn_scope_grants;
DROP TABLE idn_user_roles;
DROP TABLE idn_users;
