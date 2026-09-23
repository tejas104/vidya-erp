-- Down: restore the three-kind check (fails while guardian rows remain; the
-- audit log is append-only, so that is the correct refusal).
ALTER TABLE sys_audit_log DROP CONSTRAINT sys_audit_log_actor_type_check;
ALTER TABLE sys_audit_log
  ADD CONSTRAINT sys_audit_log_actor_type_check
  CHECK (actor_type IN ('user', 'service', 'system'));
