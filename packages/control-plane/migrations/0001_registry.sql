-- Run only against the separately credentialed vendor control-plane database.
CREATE TABLE cp_operators (
  id uuid PRIMARY KEY,
  identity_subject text NOT NULL UNIQUE CHECK (length(identity_subject) BETWEEN 3 AND 255),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 255),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cp_tenants (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{2,62}$'),
  school_name text NOT NULL CHECK (length(btrim(school_name)) BETWEEN 2 AND 160),
  edition text NOT NULL DEFAULT 'school' CHECK (edition = 'school'),
  planned_seats integer NOT NULL CHECK (planned_seats BETWEEN 1 AND 100000),
  deployment_state text NOT NULL DEFAULT 'requested' CHECK (deployment_state IN ('requested','provisioning','ready_for_onboarding','active','failed','offboarding')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cp_subscription_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES cp_tenants(id),
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('trial','active','past_due','grace','restricted','suspended','cancelled')),
  paid_through date NOT NULL,
  grace_days integer NOT NULL DEFAULT 30 CHECK (grace_days = 30),
  operator_id uuid NOT NULL REFERENCES cp_operators(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, revision)
);
CREATE INDEX cp_subscription_events_latest ON cp_subscription_events (tenant_id, revision DESC);

CREATE TABLE cp_operator_audit (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES cp_operators(id),
  action text NOT NULL,
  tenant_id uuid REFERENCES cp_tenants(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cp_operator_audit_recent ON cp_operator_audit (occurred_at DESC, id DESC);

CREATE FUNCTION cp_reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'control-plane history is append-only';
END $$;
CREATE TRIGGER cp_subscription_events_immutable BEFORE UPDATE OR DELETE ON cp_subscription_events FOR EACH ROW EXECUTE FUNCTION cp_reject_history_change();
CREATE TRIGGER cp_operator_audit_immutable BEFORE UPDATE OR DELETE ON cp_operator_audit FOR EACH ROW EXECUTE FUNCTION cp_reject_history_change();
