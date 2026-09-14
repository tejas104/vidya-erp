DROP INDEX sys_audit_log_org_id_idx;
ALTER TABLE sys_audit_log DROP CONSTRAINT sys_audit_log_org_check;
ALTER TABLE sys_audit_log DROP COLUMN org;
