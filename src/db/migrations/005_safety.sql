-- Safety state: the clock high-water mark (time-travel defence) and related markers. One row per key; the clock
-- mark is only ever raised, atomically (INSERT ... ON CONFLICT DO UPDATE SET value_ms = GREATEST(...)).
CREATE TABLE IF NOT EXISTS system_metadata (
  key         TEXT PRIMARY KEY,
  value_ms    BIGINT NOT NULL,
  detail      JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO system_metadata (key, value_ms, detail)
  SELECT 'clock.high_water', (extract(epoch FROM high_water) * 1000)::bigint, '{"source":"clock_state"}'::jsonb
    FROM clock_state WHERE id = 1
ON CONFLICT (key) DO NOTHING;

-- Anti-spoofing: keyed hash of the broader network block (/16 for IPv4, /32 for IPv6). Cleared after 30 days.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS net16_hash TEXT;

-- Where scam_type came from: the reporter, the keyword rules, the local AI (Ollama), or the default ("other").
ALTER TABLE reports ADD COLUMN IF NOT EXISTS scam_type_source TEXT NOT NULL DEFAULT 'reporter';
CREATE INDEX IF NOT EXISTS reports_auto_type ON reports (scam_type_source) WHERE scam_type_source <> 'reporter';
