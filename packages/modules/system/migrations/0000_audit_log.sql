-- Module: system (table prefix: sys_)
-- Creates the append-only audit trail required by Constitution rule 7.
-- Append-only is enforced IN the database: UPDATE, DELETE and TRUNCATE are
-- blocked by triggers, so no application bug or ad-hoc session can rewrite
-- history short of dropping the trigger (a DDL act that is itself visible).

CREATE TABLE sys_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  module text NOT NULL,
  action text NOT NULL,
  actor_type text NOT NULL
    CONSTRAINT sys_audit_log_actor_type_check
    CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX sys_audit_log_occurred_at_idx ON sys_audit_log (occurred_at);
CREATE INDEX sys_audit_log_action_idx ON sys_audit_log (action);

CREATE FUNCTION sys_audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'sys_audit_log is append-only: % is not permitted', TG_OP;
END;
$fn$;

CREATE TRIGGER sys_audit_log_append_only
  BEFORE UPDATE OR DELETE ON sys_audit_log
  FOR EACH ROW EXECUTE FUNCTION sys_audit_log_block_mutation();

CREATE TRIGGER sys_audit_log_no_truncate
  BEFORE TRUNCATE ON sys_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION sys_audit_log_block_mutation();

COMMENT ON TABLE sys_audit_log IS
  'Append-only audit trail (Constitution rule 7). Owned by the system module; written only through SystemService.audit.';
