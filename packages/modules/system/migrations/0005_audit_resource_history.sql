-- Student and mark histories read one resource in descending event order.
-- The audit table stays append-only; this index changes no audit rows.
CREATE INDEX sys_audit_log_resource_history_idx
  ON sys_audit_log (resource_type, resource_id, id DESC);
