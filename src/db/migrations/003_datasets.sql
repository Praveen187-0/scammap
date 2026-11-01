-- Public research datasets, used as reference data only. They are never user reports, never shown on the map
-- as reports, and are kept by POST /admin/reset (like the verified list). Loaded with `npm run import-data`.

-- Labelled scam / ham messages (for example the Financial Scams Detection dataset, English and Bangla).
CREATE TABLE IF NOT EXISTS dataset_messages (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('scam', 'ham')),
  message TEXT NOT NULL,
  lang TEXT NOT NULL,
  category TEXT NOT NULL,
  UNIQUE (source, message)
);
CREATE INDEX IF NOT EXISTS dataset_messages_label_idx ON dataset_messages (source, label);

-- Anonymised card transactions (ULB / Worldline creditcard.csv). V1..V28 are PCA components published by the
-- dataset authors; there is no card number, merchant or location in the data.
CREATE TABLE IF NOT EXISTS card_transactions (
  id INTEGER PRIMARY KEY,        -- row number in the file (time order)
  time_s INTEGER NOT NULL,       -- seconds since the first transaction in the file
  amount NUMERIC(12, 2) NOT NULL,
  v REAL[] NOT NULL,
  is_fraud BOOLEAN NOT NULL,
  split TEXT NOT NULL,           -- train | valid | test (time-ordered)
  score REAL NOT NULL            -- model fraud probability
);
CREATE INDEX IF NOT EXISTS card_transactions_split_idx ON card_transactions (split, id);

CREATE TABLE IF NOT EXISTS dataset_models (
  name TEXT PRIMARY KEY,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  params JSONB NOT NULL,
  metrics JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_sources (
  source TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rows INTEGER NOT NULL,
  citation TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
