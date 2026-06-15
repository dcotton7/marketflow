-- Semantic text colors (if not yet applied)
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_positive" text DEFAULT '#22c55e';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_warning" text DEFAULT '#facc15';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_caution" text DEFAULT '#f472b6';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_negative" text DEFAULT '#ef4444';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_market_flow" text DEFAULT '#c084fc';

-- Logo field: convert stored transparency → opacity (higher % = more opaque)
UPDATE "sentinel_system_settings"
SET "logo_transparency" = 100 - COALESCE("logo_transparency", 12)
WHERE "logo_transparency" IS NOT NULL AND "logo_transparency" <= 50;

-- Per-region local theme overrides (shared across all instances of a region)
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "local_theme_overrides" jsonb DEFAULT '{}'::jsonb;
