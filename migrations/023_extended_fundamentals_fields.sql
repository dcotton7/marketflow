-- Migration 023: Add extended fundamentals fields to tickers
-- week52 high/low from FMP profile range or Finnhub metrics
-- dividendYield from Finnhub dividendYieldIndicatedAnnual or FMP lastDiv
-- roe from Finnhub roeTTM
-- sharesOutstanding from FMP profile

ALTER TABLE tickers
  ADD COLUMN IF NOT EXISTS week_52_high DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS week_52_low DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dividend_yield DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS roe DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS shares_outstanding DOUBLE PRECISION;
