-- ADR-0027: guardians act on the system (redeeming an invitation, and later
-- acknowledging notices), and those rows must say a guardian did it rather
-- than borrowing "user", which means staff everywhere else in this log.
ALTER TABLE sys_audit_log DROP CONSTRAINT sys_audit_log_actor_type_check;
ALTER TABLE sys_audit_log
  ADD CONSTRAINT sys_audit_log_actor_type_check
  CHECK (actor_type IN ('user', 'service', 'system', 'guardian'));
