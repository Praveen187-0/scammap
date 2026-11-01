-- Platform features: live rollups, partner accounts and webhooks, campaign links, link scans, push and Telegram
-- alert subscriptions, the transparency log, external advisory lists, and load-test results.

-- Pre-counted hourly rollups (refreshed incrementally), so dashboards never scan the reports table.
CREATE TABLE IF NOT EXISTS rollup_hourly (
  hour       TIMESTAMPTZ NOT NULL,
  pincode    TEXT NOT NULL,
  scam_type  TEXT NOT NULL,
  channel    TEXT NOT NULL,
  counted    INTEGER NOT NULL,
  set_aside  INTEGER NOT NULL,
  PRIMARY KEY (hour, pincode, scam_type, channel)
);

-- Partner organisations (banks, telecom companies, police): one row per tenant. Only a hash of the API key is kept.
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  key_hash    TEXT NOT NULL,
  watch       JSONB NOT NULL DEFAULT '{}',
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Reports that matched a tenant's watch list (identifier class or area). No reporter data.
CREATE TABLE IF NOT EXISTS tenant_hits (
  tenant_id  TEXT NOT NULL,
  report_id  TEXT NOT NULL,
  ident_key  TEXT NOT NULL,
  pincode    TEXT NOT NULL,
  scam_type  TEXT NOT NULL,
  reasons    TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, report_id)
);
CREATE INDEX IF NOT EXISTS tenant_hits_time_idx ON tenant_hits (tenant_id, at DESC);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         BIGSERIAL PRIMARY KEY,
  target     TEXT NOT NULL,          -- tenant id or connector name
  event      TEXT NOT NULL,
  status     INTEGER,
  attempts   INTEGER NOT NULL,
  error      TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_target_idx ON webhook_deliveries (target, at DESC);

-- Identifiers seen together in one report (for example a number and a link pasted from the same SMS).
CREATE TABLE IF NOT EXISTS ident_links (
  a          TEXT NOT NULL,
  b          TEXT NOT NULL,
  report_id  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b, report_id)
);
CREATE INDEX IF NOT EXISTS ident_links_b_idx ON ident_links (b);

-- Results of safe link visits (cached), and where links are hosted (servers, never people).
CREATE TABLE IF NOT EXISTS link_scans (
  url        TEXT PRIMARY KEY,
  result     JSONB NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS host_info (
  domain     TEXT PRIMARY KEY,
  ips        TEXT[] NOT NULL DEFAULT '{}',
  network    TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Area alert subscriptions. A push subscription is a browser endpoint; a Telegram chat id is needed to reply.
-- Both are stored only for people who switch alerts on, with their area, and are deleted when they switch off.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint_hash TEXT PRIMARY KEY,
  subscription  JSONB NOT NULL,
  pincode       TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS telegram_subs (
  chat_id    TEXT PRIMARY KEY,
  pincode    TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tamper-evident log of public verdict changes: each entry carries the hash of the previous one.
-- Identifiers appear only as a keyed hash, never as the number itself.
CREATE TABLE IF NOT EXISTS verdict_log (
  seq        BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL,
  ident_hash TEXT NOT NULL,
  from_verdict TEXT NOT NULL,
  to_verdict TEXT NOT NULL,
  people     INTEGER NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);

-- Identifiers listed by external feeds configured in config/connectors.yaml. Shown as "also listed by", never
-- counted as reports.
CREATE TABLE IF NOT EXISTS external_flags (
  source     TEXT NOT NULL,
  ident_key  TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, ident_key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loadtest_runs (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  result     JSONB NOT NULL
);
