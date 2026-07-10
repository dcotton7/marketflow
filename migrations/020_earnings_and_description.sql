-- Migration 020: Add earnings detail columns and company description to tickers
-- Supports tiered cache TTLs: profile (1yr), earnings (1day), metrics (7day)

ALTER TABLE tickers
  ADD COLUMN IF NOT EXISTS company_description TEXT,
  ADD COLUMN IF NOT EXISTS earnings_time TEXT,
  ADD COLUMN IF NOT EXISTS last_earnings_date TEXT,
  ADD COLUMN IF NOT EXISTS eps_actual DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS eps_estimate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS revenue_actual DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS revenue_estimate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS profile_fetched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS earnings_fetched_at TIMESTAMP;
