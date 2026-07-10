-- Migration 022: Outcome Tracking V2 — 9 checkpoints + MFE/MAE behavior tracking

-- Drop old columns that are being replaced
ALTER TABLE scanner_discoveries DROP COLUMN IF EXISTS price_eod;
ALTER TABLE scanner_discoveries DROP COLUMN IF EXISTS move_eod;

-- New checkpoint columns (keep existing price_1hr, move_1hr, price_4hr, move_4hr)
ALTER TABLE scanner_discoveries
  ADD COLUMN IF NOT EXISTS price_15m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_15m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_30m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_30m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_d1_close DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_d1_close DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_d2_open DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_d2_open DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_d2_close DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_d2_close DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_1w DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_1w DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS price_1mo DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS move_1mo DOUBLE PRECISION;

-- Behavior tracking (MFE/MAE)
ALTER TABLE scanner_discoveries
  ADD COLUMN IF NOT EXISTS peak_move DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS peak_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS peak_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worst_drawdown DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS trough_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS trough_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS giveback_pct DOUBLE PRECISION;

-- Status tracking
ALTER TABLE scanner_discoveries
  ADD COLUMN IF NOT EXISTS outcome_status VARCHAR(16) DEFAULT 'tracking',
  ADD COLUMN IF NOT EXISTS outcome_failed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

-- Index for outcome tracker queries
CREATE INDEX IF NOT EXISTS idx_scanner_disc_outcome_status 
  ON scanner_discoveries (outcome_status) WHERE outcome_tracked_at IS NULL;
