-- Global theme singleton (admin → all users)
CREATE TABLE IF NOT EXISTS "sentinel_global_theme_settings" (
  "id" serial PRIMARY KEY,
  "overlay_color" text DEFAULT '#1e3a5f',
  "overlay_transparency" integer DEFAULT 75,
  "background_color" text DEFAULT '#0f172a',
  "logo_transparency" integer DEFAULT 88,
  "secondary_overlay_color" text DEFAULT '#334155',
  "text_color_title" text DEFAULT '#ffffff',
  "text_color_header" text DEFAULT '#ffffff',
  "text_color_section" text DEFAULT '#ffffff',
  "text_color_normal" text DEFAULT '#ffffff',
  "text_color_small" text DEFAULT '#a1a1aa',
  "text_color_tiny" text DEFAULT '#71717a',
  "text_color_positive" text DEFAULT '#22c55e',
  "text_color_warning" text DEFAULT '#facc15',
  "text_color_caution" text DEFAULT '#f472b6',
  "text_color_negative" text DEFAULT '#ef4444',
  "text_color_market_flow" text DEFAULT '#c084fc',
  "font_size_title" text DEFAULT '1.5rem',
  "font_size_header" text DEFAULT '1.125rem',
  "font_size_section" text DEFAULT '1rem',
  "font_size_normal" text DEFAULT '0.875rem',
  "font_size_small" text DEFAULT '0.8125rem',
  "font_size_tiny" text DEFAULT '0.75rem',
  "local_defaults" jsonb DEFAULT '{}'::jsonb,
  "updated_at" timestamp DEFAULT now()
);

-- Per-user local overrides column (if missing)
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "local_theme_overrides" jsonb DEFAULT '{}'::jsonb;

-- Semantic text colors on legacy per-user table (if missing)
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_positive" text DEFAULT '#22c55e';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_warning" text DEFAULT '#facc15';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_caution" text DEFAULT '#f472b6';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_negative" text DEFAULT '#ef4444';
ALTER TABLE "sentinel_system_settings" ADD COLUMN IF NOT EXISTS "text_color_market_flow" text DEFAULT '#c084fc';
