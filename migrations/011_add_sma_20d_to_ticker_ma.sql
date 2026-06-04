-- Migration 011: Add 20-day SMA to ticker_ma; default Theme Members MA1 to 20d SMA

ALTER TABLE ticker_ma ADD COLUMN IF NOT EXISTS sma_20d DOUBLE PRECISION;

-- Users on the old MA1 default (20d EMA) move to 20d SMA
UPDATE user_chart_preferences
SET theme_members_ma1 = 'sma20d'
WHERE theme_members_ma1 = 'ema20d';

ALTER TABLE user_chart_preferences
  ALTER COLUMN theme_members_ma1 SET DEFAULT 'sma20d';
