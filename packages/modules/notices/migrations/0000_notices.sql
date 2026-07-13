-- Vidya M3 (notices): the staff-room noticeboard.
CREATE TABLE ntc_notices (
  id text PRIMARY KEY,
  college_id text NOT NULL,
  -- college | staff | students | department:<id> | class:<id>
  audience text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  publish_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ntc_notices_window_check CHECK (expires_at IS NULL OR expires_at > publish_at)
);

-- The visible-feed query: live notices of a college, newest first.
CREATE INDEX ntc_notices_feed_idx ON ntc_notices (college_id, publish_at DESC);
