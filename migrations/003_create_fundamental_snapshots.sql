-- Create fundamental_snapshots for historical tracking (quarterly earnings-based)
CREATE TABLE IF NOT EXISTS fundamental_snapshots (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL REFERENCES tickers(symbol),
  snapshot_date DATE NOT NULL,
  -- Market data
  market_cap DOUBLE PRECISION,
  market_cap_size TEXT,
  -- Fundamentals (from earnings)
  pe DOUBLE PRECISION,
  beta DOUBLE PRECISION,
  debt_to_equity DOUBLE PRECISION,
  pre_tax_margin DOUBLE PRECISION,
  revenue DOUBLE PRECISION,
  profit DOUBLE PRECISION,
  -- Classification
  sector TEXT,
  industry TEXT,
  theme_id TEXT,
  -- Analyst data
  analyst_consensus TEXT,
  target_price DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(symbol, snapshot_date)
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_fundamental_snapshots_symbol ON fundamental_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_fundamental_snapshots_date ON fundamental_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_fundamental_snapshots_symbol_date ON fundamental_snapshots(symbol, snapshot_date);

COMMENT ON TABLE fundamental_snapshots IS 'Historical fundamental data snapshots (quarterly earnings-based)';
COMMENT ON COLUMN fundamental_snapshots.snapshot_date IS 'Date of snapshot (typically earnings release date)';
