-- Migration 026: Outcome Tracking V3 versioning
--
-- Does NOT rewrite or delete existing discovery/outcome rows.
-- New columns let Lab/evidence queries separate legacy V2 prints from
-- V3 exact-bar checkpoints and keep a fixed proxy symbol for market/theme rows.

ALTER TABLE scanner_discoveries
  ADD COLUMN IF NOT EXISTS outcome_contract_version VARCHAR(8),
  ADD COLUMN IF NOT EXISTS outcome_proxy_symbol VARCHAR(16),
  ADD COLUMN IF NOT EXISTS intraday_complete_at TIMESTAMPTZ;

-- Existing filled rows are legacy/provisional unless already stamped.
UPDATE scanner_discoveries
SET outcome_contract_version = 'v2'
WHERE outcome_contract_version IS NULL
  AND (
    price_15m IS NOT NULL
    OR price_30m IS NOT NULL
    OR price_1hr IS NOT NULL
    OR price_4hr IS NOT NULL
    OR peak_move IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_scanner_disc_outcome_version
  ON scanner_discoveries (outcome_contract_version, signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scanner_disc_intraday_pending
  ON scanner_discoveries (id ASC)
  WHERE intraday_complete_at IS NULL
    AND outcome_tracked_at IS NULL;
