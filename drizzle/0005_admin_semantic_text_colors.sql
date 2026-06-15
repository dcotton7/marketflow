ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_positive" text DEFAULT '#22c55e';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_warning" text DEFAULT '#facc15';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_caution" text DEFAULT '#f472b6';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_negative" text DEFAULT '#ef4444';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_market_flow" text DEFAULT '#c084fc';
