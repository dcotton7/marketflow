-- Scanner discoveries — persisted feed history
CREATE TABLE IF NOT EXISTS scanner_discoveries (
  id            SERIAL PRIMARY KEY,
  pipeline_id   VARCHAR(64)  NOT NULL,
  pipeline_name VARCHAR(128) NOT NULL,
  signal_type   VARCHAR(32)  NOT NULL,
  subject       VARCHAR(16)  NOT NULL,
  subject_kind  VARCHAR(16)  NOT NULL,
  direction     VARCHAR(8)   NOT NULL,
  magnitude     NUMERIC(8,2) NOT NULL DEFAULT 0,
  priority      VARCHAR(8)   NOT NULL DEFAULT 'normal',
  headline      TEXT         NOT NULL,
  narrative     TEXT         NOT NULL,
  tickers       TEXT[]       NOT NULL DEFAULT '{}',
  theme_id      VARCHAR(64),
  qualify_score  NUMERIC(5,1) NOT NULL DEFAULT 0,
  context_json  JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scanner_disc_created ON scanner_discoveries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_disc_subject ON scanner_discoveries (subject);
CREATE INDEX IF NOT EXISTS idx_scanner_disc_pipeline ON scanner_discoveries (pipeline_id);
