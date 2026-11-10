-- Migration 027: indexes for the outcome tracker's selection (server/scanner/outcome-tracker.ts)
--
-- On 10 Nov the tracker's selection took 12-54 min a cycle: ~590k flood repeats (lod_bounce, hod_fade, ...) are
-- never clocked, so they stay open, and every cycle's 47 queries walk them and probe each one's first print of
-- the day. These two indexes make both steps small:
-- 1. the "no earlier print of this type and name today" probe (floodFirstEpisodeSql) becomes one index range;
-- 2. each per-type query walks only that type's open rows, in id order, not every open row.
--
-- CONCURRENTLY: no table lock while they build (run each statement on its own, outside a transaction).
-- No data is modified or deleted by this migration.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scanner_disc_type_subject_created
  ON scanner_discoveries (signal_type, subject, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scanner_disc_open_type_id
  ON scanner_discoveries (signal_type, id)
  WHERE outcome_tracked_at IS NULL;
