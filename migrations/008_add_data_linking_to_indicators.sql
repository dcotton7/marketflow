-- Migration: Add data linking (provides/consumes) to user_indicators
-- Purpose: Enable custom indicators to chain with other indicators via data linking

-- Add provides column (JSON array of outputs this indicator provides)
ALTER TABLE user_indicators 
ADD COLUMN IF NOT EXISTS provides jsonb DEFAULT '[]'::jsonb;

-- Add consumes column (JSON array of inputs this indicator can receive)
ALTER TABLE user_indicators 
ADD COLUMN IF NOT EXISTS consumes jsonb DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN user_indicators.provides IS 'Array of data outputs: [{ linkType: string, paramName: string }]';
COMMENT ON COLUMN user_indicators.consumes IS 'Array of data inputs: [{ paramName: string, dataKey: string }]';
