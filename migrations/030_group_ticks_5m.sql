-- Migration 030: append-only 5-minute history for sectors and cap-size buckets (docs/gateway-reads.md, item 3), next
-- to theme_ticks_5m (migration 028). Nothing in the app deletes, updates or prunes this table; every write is an
-- INSERT ... ON CONFLICT DO NOTHING on (slot_at, kind, group_id). server/market-condition/engine/group-ticks.ts runs
-- the same statements (CREATE ... IF NOT EXISTS) before its first write, so no manual step is needed on deploy.
-- kind: 'sector' (tickers.sector), 'size' (tickers.market_cap_size), 'benchmark' (group_id 'SPY': SPY's day %).
-- Growth: about 20 rows a slot, 78 slots a day, ~150 KB a day.

CREATE TABLE IF NOT EXISTS group_ticks_5m (
  id SERIAL PRIMARY KEY,
  slot_at TIMESTAMPTZ NOT NULL,
  market_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  group_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  median_pct DOUBLE PRECISION NOT NULL,
  breadth_pct DOUBLE PRECISION,
  members INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (slot_at, kind, group_id)
);
CREATE INDEX IF NOT EXISTS idx_group_ticks_5m_kind ON group_ticks_5m (kind, slot_at);
