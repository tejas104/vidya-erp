-- Module: system (table prefix: sys_)
-- Per-user keyed preference store. #11 task 12 (onboarding checklists) will
-- use this to persist dismissal and manual check-off state, keyed by
-- arbitrary caller-chosen keys.
--
-- Reads and writes are ALWAYS scoped to the caller's own principal id at the
-- handler layer (packages/modules/system/src/api/handlers.ts) — the user id
-- is never taken from the request. This table itself carries no additional
-- ownership metadata beyond user_id, so there is nothing further to
-- scope-check.

CREATE TABLE sys_user_preferences (
  user_id    uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

COMMENT ON TABLE sys_user_preferences IS
  'Per-user keyed preference store. Owned by the system module; scoped to principal.id at the handler layer — never trust a request-supplied user id.';
