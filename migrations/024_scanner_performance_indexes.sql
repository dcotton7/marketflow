-- Migration 024: Performance indexes for scanner_discoveries
--
-- These indexes optimize the three hottest query patterns:
-- 1. Outcome tracker: SELECT ... WHERE outcome_tracked_at IS NULL ORDER BY id DESC LIMIT 5000
-- 2. Workbench hit-rates: SELECT ... WHERE created_at BETWEEN $1 AND $2 [AND signal_type = $3]
-- 3. Workbench cards / history: SELECT ... WHERE signal_type = $1 AND created_at BETWEEN ...
--
-- No data is modified or deleted by this migration.

-- Outcome tracker hot query: finds untracked signals quickly
-- Partial index keeps it small — only covers rows still pending tracking
CREATE INDEX IF NOT EXISTS idx_scanner_disc_pending_id
  ON scanner_discoveries (id DESC)
  WHERE outcome_tracked_at IS NULL;

-- Workbench hit-rates and cards: filter by signal_type + date range
CREATE INDEX IF NOT EXISTS idx_scanner_disc_type_created
  ON scanner_discoveries (signal_type, created_at DESC);

-- Workbench session filtering: filter by date range + session
CREATE INDEX IF NOT EXISTS idx_scanner_disc_created_session
  ON scanner_discoveries (created_at DESC, session_at_signal);
