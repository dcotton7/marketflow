-- Rename fundamentals_cache to tickers (master ticker registry)
ALTER TABLE fundamentals_cache RENAME TO tickers;

-- Add theme assignment columns
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS theme_id TEXT REFERENCES themes(id);
ALTER TABLE tickers ADD COLUMN IF NOT EXISTS is_core BOOLEAN DEFAULT false;

-- Add indexes for theme queries
CREATE INDEX IF NOT EXISTS idx_tickers_theme_id ON tickers(theme_id);
CREATE INDEX IF NOT EXISTS idx_tickers_is_core ON tickers(is_core);
CREATE INDEX IF NOT EXISTS idx_tickers_theme_core ON tickers(theme_id, is_core);

COMMENT ON TABLE tickers IS 'Master ticker registry with current fundamentals and theme assignment';
COMMENT ON COLUMN tickers.theme_id IS 'Current theme assignment - ticker trades with this group (ONE theme per ticker)';
COMMENT ON COLUMN tickers.is_core IS 'Core member (true) vs candidate (false) for leader selection';
