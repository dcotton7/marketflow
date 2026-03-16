-- Add accumulation/distribution tracking column to theme_snapshots
-- Positive values = accumulation days in a row, negative = distribution days in a row

ALTER TABLE theme_snapshots
ADD COLUMN IF NOT EXISTS acc_dist_days INTEGER DEFAULT 0;

COMMENT ON COLUMN theme_snapshots.acc_dist_days IS 'Accumulation/Distribution streak count (William O''Neal style): positive=accumulation, negative=distribution, 0=flat';
