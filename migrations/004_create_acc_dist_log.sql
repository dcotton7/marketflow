-- Create acc_dist_log for daily A/D audit trail (optional debugging)
CREATE TABLE IF NOT EXISTS acc_dist_log (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL REFERENCES tickers(symbol),
  date DATE NOT NULL,
  acc_dist_days INTEGER NOT NULL,
  price_change_pct DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(symbol, date)
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_acc_dist_log_symbol ON acc_dist_log(symbol);
CREATE INDEX IF NOT EXISTS idx_acc_dist_log_date ON acc_dist_log(date);

COMMENT ON TABLE acc_dist_log IS 'Daily A/D change log for debugging and historical analysis';
COMMENT ON COLUMN acc_dist_log.acc_dist_days IS 'A/D streak value on this date';
COMMENT ON COLUMN acc_dist_log.price_change_pct IS 'Daily price change % that caused A/D update';
