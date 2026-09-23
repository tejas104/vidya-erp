-- ADR-0027: guardian identity. Three tables, all owned by people:
--
--   ppl_guardians            one row per real adult; linked to an identity
--                            account (kind 'guardian') once they redeem an
--                            invitation. Phone/email are contact channels,
--                            never identifiers: two guardians may share one.
--   ppl_student_guardians    one row per (guardian, student) relationship —
--                            the ONLY source of a guardian's authority.
--   ppl_guardian_invitations single-use, 72-hour, hash-only invitation codes
--                            issued by staff for one pupil.
--
-- identity_user_id is an opaque cross-module reference (no FK, Constitution
-- rule 2), same convention as ppl_students/ppl_teachers.

CREATE TABLE ppl_guardians (
  id text PRIMARY KEY,
  identity_user_id text NOT NULL,
  full_name text NOT NULL,
  primary_phone text,
  primary_email text,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT ppl_guardians_status_check CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_guardians_identity_idx ON ppl_guardians (identity_user_id);

CREATE TABLE ppl_student_guardians (
  id text PRIMARY KEY,
  guardian_id text NOT NULL REFERENCES ppl_guardians (id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES ppl_students (id) ON DELETE CASCADE,
  college_id text NOT NULL,
  relationship_type text NOT NULL
    CONSTRAINT ppl_sg_type_check CHECK (relationship_type IN ('parent', 'legal-guardian', 'other-authorized-contact')),
  is_primary_contact boolean NOT NULL DEFAULT false,
  verification_state text NOT NULL
    CONSTRAINT ppl_sg_verification_check CHECK (verification_state IN ('unverified', 'self-attested', 'staff-verified')),
  status text NOT NULL
    CONSTRAINT ppl_sg_status_check CHECK (status IN ('pending', 'active', 'restricted', 'revoked', 'expired')),
  granted_categories text[] NOT NULL,
  restrictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  historical_access_until timestamptz,
  status_reason text,
  status_changed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ADR-0027 Decision 5: an other-authorized-contact is never active
  -- without staff verification, in any configuration. Held here so no code
  -- path — including a future one — can activate one without it.
  CONSTRAINT ppl_sg_contact_verified_check CHECK (
    relationship_type <> 'other-authorized-contact'
    OR status NOT IN ('active', 'restricted')
    OR verification_state = 'staff-verified'
  )
);
CREATE UNIQUE INDEX ppl_sg_pair_idx ON ppl_student_guardians (guardian_id, student_id);
CREATE INDEX ppl_sg_student_idx ON ppl_student_guardians (student_id);

CREATE TABLE ppl_guardian_invitations (
  id text PRIMARY KEY,
  student_id text NOT NULL REFERENCES ppl_students (id) ON DELETE CASCADE,
  college_id text NOT NULL,
  guardian_name text NOT NULL,
  relationship_type text NOT NULL
    CONSTRAINT ppl_gi_type_check CHECK (relationship_type IN ('parent', 'legal-guardian', 'other-authorized-contact')),
  contact_method text NOT NULL CONSTRAINT ppl_gi_method_check CHECK (contact_method IN ('sms', 'email')),
  contact_value text NOT NULL,
  staff_verified boolean NOT NULL DEFAULT false,
  -- sha256 of the code; the code itself is shown to staff once and never stored.
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT ppl_gi_status_check CHECK (status IN ('pending', 'activated', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  issued_by text NOT NULL,
  activated_relationship_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ppl_gi_code_idx ON ppl_guardian_invitations (code_hash);
CREATE INDEX ppl_gi_student_idx ON ppl_guardian_invitations (student_id);
