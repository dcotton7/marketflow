-- Add Ivy AI Integration fields to bigidea_setups table
-- These fields allow setup creators to define how Ivy should suggest entries, stops, and targets

ALTER TABLE bigidea_setups 
ADD COLUMN IF NOT EXISTS ivy_entry_strategy TEXT;

ALTER TABLE bigidea_setups 
ADD COLUMN IF NOT EXISTS ivy_stop_strategy TEXT;

ALTER TABLE bigidea_setups 
ADD COLUMN IF NOT EXISTS ivy_target_strategy TEXT;

ALTER TABLE bigidea_setups 
ADD COLUMN IF NOT EXISTS ivy_context_notes TEXT;

ALTER TABLE bigidea_setups 
ADD COLUMN IF NOT EXISTS ivy_approved BOOLEAN DEFAULT FALSE;

-- Comment on columns for documentation
COMMENT ON COLUMN bigidea_setups.ivy_entry_strategy IS 'Entry strategy type: breakout, rally_reclaim (U&R), ma_touch, pullback_bounce, gap_fill';
COMMENT ON COLUMN bigidea_setups.ivy_stop_strategy IS 'Stop strategy type: below_base, below_undercut, below_ma, atr_based, prior_day_low';
COMMENT ON COLUMN bigidea_setups.ivy_target_strategy IS 'Target strategy type: swing_high, measured_move, rr_based, extension, trailing';
COMMENT ON COLUMN bigidea_setups.ivy_context_notes IS 'Free-form guidance text that Ivy will include in suggestions';
COMMENT ON COLUMN bigidea_setups.ivy_approved IS 'When true, Ivy will use this setup config for suggestions';
