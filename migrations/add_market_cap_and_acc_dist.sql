-- Add market cap size category and A/D tracking to fundamentals_cache
-- This enables size-filtered theme calculations and ticker A/D analysis

-- Add market_cap_size column for size filter categories
ALTER TABLE fundamentals_cache
ADD COLUMN IF NOT EXISTS market_cap_size TEXT;

COMMENT ON COLUMN fundamentals_cache.market_cap_size IS 'Market cap category: MEGA (>$200B), LARGE ($10B-$200B), MID ($2B-$10B), SMALL ($300M-$2B), MICRO (<$300M)';

-- Add acc_dist_days column for accumulation/distribution tracking
ALTER TABLE fundamentals_cache
ADD COLUMN IF NOT EXISTS acc_dist_days INTEGER DEFAULT 0;

COMMENT ON COLUMN fundamentals_cache.acc_dist_days IS 'Accumulation/Distribution streak count (William O''Neal style): positive=accumulation, negative=distribution, 0=flat';

-- Create index on market_cap_size for fast filtering
CREATE INDEX IF NOT EXISTS idx_fundamentals_market_cap_size ON fundamentals_cache(market_cap_size);

-- Create index on acc_dist_days for A/D aggregate queries
CREATE INDEX IF NOT EXISTS idx_fundamentals_acc_dist_days ON fundamentals_cache(acc_dist_days);
