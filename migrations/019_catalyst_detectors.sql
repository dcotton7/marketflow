-- Catalyst Detector tables — pending catalysts with decay + admin-editable rules

-- Active catalyst entries (pending delayed reactions)
CREATE TABLE IF NOT EXISTS catalyst_detectors (
  id                    SERIAL PRIMARY KEY,
  subject               VARCHAR(32)   NOT NULL,
  subject_kind          VARCHAR(16)   NOT NULL DEFAULT 'ticker',
  catalyst_type         VARCHAR(32)   NOT NULL,
  headline              TEXT          NOT NULL,
  source                VARCHAR(16)   NOT NULL DEFAULT 'system',
  fired_at              TIMESTAMPTZ   NOT NULL,
  expires_at            TIMESTAMPTZ   NOT NULL,
  initial_reaction      VARCHAR(16)   NOT NULL DEFAULT 'flat',
  expected_direction    VARCHAR(12)   NOT NULL DEFAULT 'up',
  decay_weight          NUMERIC(4,2)  NOT NULL DEFAULT 1.0,
  resolved              BOOLEAN       NOT NULL DEFAULT FALSE,
  resolved_at           TIMESTAMPTZ,
  resolution_magnitude  NUMERIC(8,2),
  rule_id               VARCHAR(64),
  owner_id              INTEGER,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalyst_subject    ON catalyst_detectors (subject);
CREATE INDEX IF NOT EXISTS idx_catalyst_active     ON catalyst_detectors (resolved, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalyst_type       ON catalyst_detectors (catalyst_type);
CREATE INDEX IF NOT EXISTS idx_catalyst_fired      ON catalyst_detectors (fired_at DESC);

-- Admin-editable catalyst rules
CREATE TABLE IF NOT EXISTS catalyst_rules (
  id                    VARCHAR(64)   PRIMARY KEY,
  name                  VARCHAR(128)  NOT NULL,
  enabled               BOOLEAN       NOT NULL DEFAULT TRUE,
  catalyst_type         VARCHAR(32)   NOT NULL,
  description           TEXT          NOT NULL DEFAULT '',
  window_days           INTEGER       NOT NULL DEFAULT 5,
  decay_shape           VARCHAR(16)   NOT NULL DEFAULT 'linear',
  boost_multiplier      NUMERIC(4,2)  NOT NULL DEFAULT 1.0,
  min_news_severity     INTEGER,
  keywords              TEXT[]        NOT NULL DEFAULT '{}',
  contrary_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  owner_id              INTEGER,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Session segment returns (for multi-day pattern tracking)
CREATE TABLE IF NOT EXISTS session_segment_stats (
  id            SERIAL PRIMARY KEY,
  market_date   DATE        NOT NULL,
  segment       VARCHAR(16) NOT NULL,
  spy_return    NUMERIC(6,3) NOT NULL DEFAULT 0,
  qqq_return    NUMERIC(6,3) NOT NULL DEFAULT 0,
  iwm_return    NUMERIC(6,3) NOT NULL DEFAULT 0,
  avg_theme_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  themes_up     INTEGER NOT NULL DEFAULT 0,
  themes_down   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(market_date, segment)
);

CREATE INDEX IF NOT EXISTS idx_session_seg_date ON session_segment_stats (market_date DESC);
