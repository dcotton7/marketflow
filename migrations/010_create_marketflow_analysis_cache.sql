-- Migration 010: MarketFlow AI Analysis Cache
-- Stores full analysis payload per symbol for 3-day reuse (Use Cached vs Re-run prompt)

CREATE TABLE IF NOT EXISTS marketflow_analysis_cache (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL UNIQUE,
  analysis_json JSONB NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  version TEXT NOT NULL DEFAULT 'v1',
  modules_present JSONB NOT NULL,
  ttl_days INTEGER NOT NULL DEFAULT 3,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketflow_analysis_cache_symbol ON marketflow_analysis_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_marketflow_analysis_cache_generated_at ON marketflow_analysis_cache(generated_at DESC);
