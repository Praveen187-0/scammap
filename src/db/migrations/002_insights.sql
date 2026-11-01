-- Adds privacy-safe fields for analytics and personal-number protection.

-- Money lost as a coarse band only (0 none, 1 under ₹10k, 2 ₹10k-1L, 3 over ₹1L). Never the exact amount.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS loss_band SMALLINT NOT NULL DEFAULT 0;

-- The note described a personal relationship with the number's owner ("my ex", "owes me money"):
-- a grudge, not a scam pattern. The note itself is still never stored.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS personal_dispute BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS reports_occurred_idx ON reports (occurred_at);

-- Counts of rejected and slowed-down reports per day and reason. No identifiers, no reporter data.
CREATE TABLE IF NOT EXISTS ingest_stats (
  day     DATE NOT NULL,
  reason  TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reason)
);
