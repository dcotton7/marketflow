-- Migration 009: Create historical_bars and ticker_ma tables for Data Layer
-- These tables cache historical daily bar data and pre-calculated moving averages

-- Historical daily bars (OHLCV) - stores 250 days per ticker
CREATE TABLE IF NOT EXISTS historical_bars (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  bar_date TEXT NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  vwap DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(symbol, bar_date)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_historical_bars_symbol ON historical_bars(symbol);
CREATE INDEX IF NOT EXISTS idx_historical_bars_date ON historical_bars(bar_date DESC);
CREATE INDEX IF NOT EXISTS idx_historical_bars_symbol_date ON historical_bars(symbol, bar_date DESC);

-- Pre-calculated moving averages per ticker
CREATE TABLE IF NOT EXISTS ticker_ma (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  ema_10d DOUBLE PRECISION,
  ema_20d DOUBLE PRECISION,
  sma_50d DOUBLE PRECISION,
  sma_200d DOUBLE PRECISION,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for symbol lookups
CREATE INDEX IF NOT EXISTS idx_ticker_ma_symbol ON ticker_ma(symbol);
