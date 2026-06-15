ALTER TABLE sentinel_imported_trades
  ADD COLUMN IF NOT EXISTS cash_balance double precision;
