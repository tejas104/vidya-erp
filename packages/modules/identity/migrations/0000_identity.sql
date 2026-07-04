-- Module: identity (table prefix: idn_)
-- Users, role memberships, scope grants, reset tokens. Sessions live in
-- Redis (human-owned SessionManager), never in Postgres.
-- Org identifiers are opaque text under the #3 identifier contract: no
-- foreign keys to org tables (they do not exist yet).

CREATE TABLE idn_users (
  id text PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'must_reset'
    CONSTRAINT idn_users_status_check
    CHECK (status IN ('active', 'disabled', 'must_reset')),
  college_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without the citext extension.
CREATE UNIQUE INDEX idn_users_username_idx ON idn_users (lower(username));

CREATE TABLE idn_user_roles (
  user_id text NOT NULL REFERENCES idn_users (id) ON DELETE CASCADE,
  role text NOT NULL
    CONSTRAINT idn_user_roles_role_check
    CHECK (role IN ('admin', 'principal', 'hod', 'class_teacher', 'teacher')),
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE idn_scope_grants (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  role text NOT NULL,
  college_id text NOT NULL,
  department_id text,
  class_id text,
  section_id text,
  subject_id text,
  verified boolean NOT NULL DEFAULT false,
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A grant can only be held under a role the user actually has; revoking
  -- the role cascades away its grants.
  CONSTRAINT idn_scope_grants_role_fk
    FOREIGN KEY (user_id, role)
    REFERENCES idn_user_roles (user_id, role) ON DELETE CASCADE,
  -- Hierarchical integrity of the org path.
  CONSTRAINT idn_scope_grants_path_check CHECK (
    (section_id IS NULL OR class_id IS NOT NULL)
    AND (class_id IS NULL OR department_id IS NOT NULL)
  ),
  -- Shape of the grant per role (approved model, ADR-0010).
  CONSTRAINT idn_scope_grants_shape_check CHECK (
    (role = 'teacher' AND subject_id IS NOT NULL AND class_id IS NOT NULL)
    OR (role = 'class_teacher' AND subject_id IS NULL AND class_id IS NOT NULL)
    OR (role = 'hod' AND subject_id IS NULL AND department_id IS NOT NULL
        AND class_id IS NULL AND section_id IS NULL)
    OR (role IN ('principal', 'admin') AND subject_id IS NULL
        AND department_id IS NULL AND class_id IS NULL AND section_id IS NULL)
  )
);

CREATE INDEX idn_scope_grants_user_idx ON idn_scope_grants (user_id);

CREATE TABLE idn_reset_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES idn_users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idn_reset_tokens_hash_idx ON idn_reset_tokens (token_hash);
CREATE INDEX idn_reset_tokens_expires_idx ON idn_reset_tokens (expires_at);

COMMENT ON TABLE idn_users IS
  'Identity module: local user accounts. Passwords stored as argon2 hashes produced by the HUMAN-OWNED PasswordHasher.';
COMMENT ON TABLE idn_scope_grants IS
  'Identity module: role+scope authority grants against opaque org identifiers (#3 contract). verified=false until the OrgDirectory exists.';
