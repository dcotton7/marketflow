CREATE TABLE IF NOT EXISTS sentinel_journal_cash_anchor (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  broker_id TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  anchor_cash DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, broker_id)
);

CREATE TABLE IF NOT EXISTS sentinel_journal_cash_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  broker_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  label TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_cash_events_user_broker
  ON sentinel_journal_cash_events (user_id, broker_id, event_date);
