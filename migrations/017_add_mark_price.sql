ALTER TABLE sentinel_trades ADD COLUMN IF NOT EXISTS mark_price double precision;
ALTER TABLE sentinel_trades ADD COLUMN IF NOT EXISTS mark_updated_at timestamp;
