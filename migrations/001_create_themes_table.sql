-- Create themes table for market condition themes
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('Macro', 'Structural', 'Narrative')),
  leaders_target INTEGER DEFAULT 5,
  notes TEXT,
  etf_proxies JSONB, -- Array of {symbol, name, proxyType}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add index for tier filtering
CREATE INDEX IF NOT EXISTS idx_themes_tier ON themes(tier);

COMMENT ON TABLE themes IS 'Market condition themes/clusters - behavioral groups of stocks that trade together';
COMMENT ON COLUMN themes.id IS 'Theme identifier (e.g., SEMIS, AI_INFRA)';
COMMENT ON COLUMN themes.tier IS 'Theme classification: Macro (broad economy), Structural (infrastructure), Narrative (speculative)';
COMMENT ON COLUMN themes.leaders_target IS 'Target number of leader stocks to track for this theme';
COMMENT ON COLUMN themes.etf_proxies IS 'ETF proxies for this theme with proxy types (direct, adjacent, macro, hedge)';
