ALTER TABLE user_chart_preferences
  ADD COLUMN IF NOT EXISTS last_intraday_timeframe text NOT NULL DEFAULT '5min';
