-- Custom Indicators System
-- Allows users to create custom indicators when no match is found

CREATE TABLE IF NOT EXISTS user_indicators (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sentinel_users(id) ON DELETE CASCADE,
  
  -- Identifier
  custom_id TEXT NOT NULL UNIQUE,
  
  -- Definition
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- Parameters (JSON array of parameter definitions)
  params JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Evaluation logic (DSL-based)
  logic_type TEXT NOT NULL DEFAULT 'rule_based',
  logic_definition JSONB NOT NULL,
  
  -- Approval workflow
  is_admin_approved BOOLEAN DEFAULT FALSE,
  approved_by_admin_id INTEGER REFERENCES sentinel_users(id),
  approved_at TIMESTAMP,
  promoted_to_core_id TEXT,
  
  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  total_passes INTEGER DEFAULT 0,
  total_evaluations INTEGER DEFAULT 0,
  avg_pass_rate DOUBLE PRECISION,
  
  -- Auto-submit tracking
  auto_submitted_at TIMESTAMP,
  
  -- Metadata
  ai_generated BOOLEAN DEFAULT TRUE,
  ai_model TEXT,
  ai_prompt TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_indicators_user ON user_indicators(user_id);
CREATE INDEX idx_user_indicators_approval ON user_indicators(is_admin_approved);
CREATE INDEX idx_user_indicators_usage ON user_indicators(times_used DESC);
CREATE INDEX idx_user_indicators_custom_id ON user_indicators(custom_id);

-- Approval queue tracking
CREATE TABLE IF NOT EXISTS indicator_approval_queue (
  id SERIAL PRIMARY KEY,
  indicator_id INTEGER NOT NULL REFERENCES user_indicators(id) ON DELETE CASCADE,
  submitted_at TIMESTAMP DEFAULT NOW(),
  review_notes TEXT,
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER REFERENCES sentinel_users(id),
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'needs_revision')),
  rejection_reason TEXT
);

CREATE INDEX idx_approval_queue_indicator ON indicator_approval_queue(indicator_id);
CREATE INDEX idx_approval_queue_decision ON indicator_approval_queue(decision);
