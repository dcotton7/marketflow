-- Create watchlists table for multiple named watchlists per user
CREATE TABLE IF NOT EXISTS watchlists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Add index for user lookups
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists(user_id);

-- Add watchlist_id column to sentinel_watchlist (nullable initially for migration)
ALTER TABLE sentinel_watchlist ADD COLUMN IF NOT EXISTS watchlist_id INTEGER;

-- Create default watchlist for each user who has existing watchlist items
INSERT INTO watchlists (user_id, name, is_default)
SELECT DISTINCT user_id, 'Default', TRUE
FROM sentinel_watchlist
WHERE user_id NOT IN (SELECT user_id FROM watchlists WHERE is_default = TRUE)
ON CONFLICT (user_id, name) DO NOTHING;

-- Update existing sentinel_watchlist items to reference their user's default watchlist
UPDATE sentinel_watchlist sw
SET watchlist_id = w.id
FROM watchlists w
WHERE sw.user_id = w.user_id 
  AND w.is_default = TRUE 
  AND sw.watchlist_id IS NULL;

-- Add foreign key constraint (optional, for referential integrity)
-- Note: We don't make watchlist_id NOT NULL yet to allow flexibility
ALTER TABLE sentinel_watchlist 
  ADD CONSTRAINT fk_sentinel_watchlist_watchlist_id 
  FOREIGN KEY (watchlist_id) 
  REFERENCES watchlists(id) 
  ON DELETE SET NULL;

-- Add index for watchlist lookups
CREATE INDEX IF NOT EXISTS idx_sentinel_watchlist_watchlist_id ON sentinel_watchlist(watchlist_id);

COMMENT ON TABLE watchlists IS 'User-defined watchlists for organizing monitored stocks';
COMMENT ON COLUMN watchlists.is_default IS 'Whether this is the user default watchlist (one per user)';
COMMENT ON COLUMN sentinel_watchlist.watchlist_id IS 'FK to watchlists table - which watchlist this item belongs to';
