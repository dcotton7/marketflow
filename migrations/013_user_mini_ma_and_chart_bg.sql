-- Mini-chart MA settings (separate profile; copy-on-first-use from main chart settings)
CREATE TABLE IF NOT EXISTS user_mini_ma_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  row_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ma_type TEXT NOT NULL,
  period INTEGER,
  color TEXT NOT NULL DEFAULT '#ffffff',
  line_type INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  daily_on BOOLEAN NOT NULL DEFAULT true,
  five_min_on BOOLEAN NOT NULL DEFAULT true,
  fifteen_min_on BOOLEAN NOT NULL DEFAULT true,
  thirty_min_on BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  calc_on TEXT NOT NULL DEFAULT 'daily',
  UNIQUE (user_id, row_id)
);

CREATE INDEX IF NOT EXISTS idx_user_mini_ma_settings_user_id ON user_mini_ma_settings (user_id);

-- Chart background color (null = app default #0f172a)
ALTER TABLE user_chart_preferences
  ADD COLUMN IF NOT EXISTS chart_background_color TEXT;
