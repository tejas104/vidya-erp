-- Nullable expansion: old producers remain compatible; NULL is never institution-visible.
ALTER TABLE sys_audit_log ADD COLUMN org jsonb;
ALTER TABLE sys_audit_log ADD CONSTRAINT sys_audit_log_org_check CHECK (
  org IS NULL OR (jsonb_typeof(org) = 'object' AND jsonb_typeof(org->'collegeId') = 'string' AND length(org->>'collegeId') > 0)
);
CREATE INDEX sys_audit_log_org_id_idx ON sys_audit_log ((org->>'collegeId'), id DESC);
-- Exclusive migration lock prevents concurrent writes while the append-only guard
-- is temporarily disabled. Only attribution changes; event payloads remain intact.
LOCK TABLE sys_audit_log IN ACCESS EXCLUSIVE MODE;
ALTER TABLE sys_audit_log DISABLE TRIGGER sys_audit_log_append_only;
UPDATE sys_audit_log SET org = jsonb_build_object('collegeId', details->>'collegeId')
WHERE module = 'people' AND action IN ('people.department-created', 'people.teacher-created', 'people.implicit-department-created')
  AND jsonb_typeof(details->'collegeId') = 'string' AND length(details->>'collegeId') > 0;
ALTER TABLE sys_audit_log ENABLE TRIGGER sys_audit_log_append_only;
