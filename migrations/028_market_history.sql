-- Migration 028: append-only market history for the research harness (Don, 20 Nov: "they are never supposed
-- to delete"). Nothing in the app deletes, updates or prunes these three tables; every write is an
-- INSERT ... ON CONFLICT DO NOTHING on the unique key, so a restart or a second refresh cannot double a row.
-- server/market-condition/engine/market-history.ts runs the same statements (CREATE ... IF NOT EXISTS) before its
-- first write, so no manual step is needed on deploy. Keep the two in step.
-- Growth: theme_ticks_5m ~190 KB/day, theme_membership_daily ~30 KB/day, regime_history ~30 KB/day.

CREATE TABLE IF NOT EXISTS theme_ticks_5m (
  id SERIAL PRIMARY KEY,
  slot_at TIMESTAMPTZ NOT NULL,
  market_date TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  median_pct DOUBLE PRECISION,
  rs_vs_benchmark DOUBLE PRECISION,
  breadth_pct DOUBLE PRECISION,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (slot_at, theme_id)
);
CREATE INDEX IF NOT EXISTS idx_theme_ticks_5m_date ON theme_ticks_5m (market_date, slot_at);

CREATE TABLE IF NOT EXISTS theme_membership_daily (
  id SERIAL PRIMARY KEY,
  market_date TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  is_core BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (market_date, theme_id, symbol)
);

CREATE TABLE IF NOT EXISTS regime_history (
  id SERIAL PRIMARY KEY,
  slot_at TIMESTAMPTZ NOT NULL UNIQUE,
  market_date TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL,
  risk_multiplier DOUBLE PRECISION,
  components JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regime_history_date ON regime_history (market_date, slot_at);
