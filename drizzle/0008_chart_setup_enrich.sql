-- Chart setup enrich: on-demand analysis + feedback + curated models

CREATE TABLE IF NOT EXISTS chart_setup_enrich_runs (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  symbol text NOT NULL,
  trading_day_key text,
  theme_id text,
  dossier jsonb,
  result jsonb NOT NULL,
  include_visual boolean DEFAULT false,
  source text DEFAULT 'llm',
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chart_setup_enrich_runs_user_symbol_idx
  ON chart_setup_enrich_runs (user_id, symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS chart_enrich_feedback (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  enrich_run_id integer REFERENCES chart_setup_enrich_runs(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  helpful text NOT NULL,
  correction_kind text,
  corrected_lifecycle text,
  corrected_pattern text,
  note text,
  enrich_snapshot jsonb,
  dossier jsonb,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chart_enrich_models (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  enrich_run_id integer REFERENCES chart_setup_enrich_runs(id) ON DELETE SET NULL,
  feedback_id integer REFERENCES chart_enrich_feedback(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  tier text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  pattern_label text,
  pattern_cleanliness text,
  lifecycle_stage text,
  note text,
  enrich_snapshot jsonb,
  dossier jsonb,
  apply_flag boolean DEFAULT true,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chart_enrich_models_user_tier_idx
  ON chart_enrich_models (user_id, tier, created_at DESC);
