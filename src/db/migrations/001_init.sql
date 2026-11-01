-- ScamMap schema. Idempotent: safe to run on every start.
-- Privacy: no reporter names, phone numbers, IPs, coordinates or note text are stored. Reporter and network
-- identity are keyed hashes; notes survive only as length + keyed shingle hashes.

CREATE TABLE IF NOT EXISTS reports (
  id              BIGSERIAL PRIMARY KEY,
  report_id       TEXT NOT NULL UNIQUE,
  ident_key       TEXT NOT NULL,             -- "<type>:<normalised value>"
  occurred_at     TIMESTAMPTZ NOT NULL,
  reported_at     TIMESTAMPTZ NOT NULL,
  reporter_hash   TEXT NOT NULL,             -- HMAC(pepper, reporter_id)
  ip_hash         TEXT,                      -- HMAC(pepper, ip_prefix); cleared after 30 days
  channel         TEXT NOT NULL,
  scam_type       TEXT NOT NULL,
  pincode         TEXT NOT NULL,             -- the area only, never an address
  note_len        INTEGER NOT NULL DEFAULT 0,
  note_hash       TEXT,
  note_shingles   INTEGER[] NOT NULL DEFAULT '{}',
  note_script     TEXT NOT NULL DEFAULT 'none',
  has_screenshot  BOOLEAN NOT NULL DEFAULT FALSE,
  lost_money      BOOLEAN NOT NULL DEFAULT FALSE,
  merged          BOOLEAN NOT NULL DEFAULT FALSE,
  countable       BOOLEAN NOT NULL DEFAULT FALSE, -- set by the trust engine: may feed map and alerts
  flags           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_ident_idx ON reports (ident_key, reported_at DESC);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_hash, reported_at);
CREATE INDEX IF NOT EXISTS reports_area_time_idx ON reports (pincode, occurred_at) WHERE countable;
CREATE INDEX IF NOT EXISTS reports_countable_time_idx ON reports (occurred_at) WHERE countable;

-- One row per identifier, holding the precomputed verdict so a lookup is a single primary-key read.
CREATE TABLE IF NOT EXISTS identifiers (
  ident_key        TEXT PRIMARY KEY,
  identifier_type  TEXT NOT NULL,
  normalized       TEXT NOT NULL,
  case_id          TEXT NOT NULL UNIQUE,
  assessment       JSONB,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reputation: which other identifiers a reporter helped confirm, or took part in faking.
CREATE TABLE IF NOT EXISTS reporter_marks (
  reporter_hash  TEXT NOT NULL,
  ident_key      TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('corroborated', 'flagged')),
  PRIMARY KEY (reporter_hash, ident_key, kind)
);

CREATE TABLE IF NOT EXISTS challenges (
  challenge_id   TEXT PRIMARY KEY,
  ident_key      TEXT NOT NULL,
  claimant_name  TEXT,
  contact_email  TEXT,                       -- the business's contact; never returned or logged
  proof_note     TEXT,
  status         TEXT NOT NULL DEFAULT 'under_review',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenges_ident_idx ON challenges (ident_key);

-- Survives /admin/reset.
CREATE TABLE IF NOT EXISTS verified (
  ident_key        TEXT PRIMARY KEY,
  identifier_type  TEXT NOT NULL,
  normalized       TEXT NOT NULL,
  owner            TEXT NOT NULL
);

-- Survives /admin/reset.
CREATE TABLE IF NOT EXISTS licence_state (
  id            SMALLINT PRIMARY KEY CHECK (id = 1),
  licence       JSONB NOT NULL,
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Survives /admin/reset. Latest server time ever seen, to catch the clock being set back.
CREATE TABLE IF NOT EXISTS clock_state (
  id          SMALLINT PRIMARY KEY CHECK (id = 1),
  high_water  TIMESTAMPTZ NOT NULL
);
