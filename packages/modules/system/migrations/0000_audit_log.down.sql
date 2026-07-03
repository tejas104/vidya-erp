-- Rollback of 0000_audit_log. DESTROYS ALL AUDIT HISTORY — in any shared
-- environment, take a backup first (docs/runbook.md#rollback).

DROP TRIGGER sys_audit_log_no_truncate ON sys_audit_log;
DROP TRIGGER sys_audit_log_append_only ON sys_audit_log;
DROP FUNCTION sys_audit_log_block_mutation();
DROP TABLE sys_audit_log;
