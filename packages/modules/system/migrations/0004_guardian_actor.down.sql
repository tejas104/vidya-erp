-- Down: restore the three-kind check for NEW rows only. NOT VALID skips
-- existing rows, so guardian-actor rows already written stay exactly as they
-- are: the audit log is append-only history, and rolling back the code must
-- not rewrite who did what.
ALTER TABLE sys_audit_log DROP CONSTRAINT sys_audit_log_actor_type_check;
ALTER TABLE sys_audit_log
  ADD CONSTRAINT sys_audit_log_actor_type_check
  CHECK (actor_type IN ('user', 'service', 'system')) NOT VALID;
