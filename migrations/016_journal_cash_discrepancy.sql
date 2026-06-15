ALTER TABLE sentinel_journal_cash_anchor
  ADD COLUMN IF NOT EXISTS tracked_cash DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS discrepancy_amount DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS discrepancy_note TEXT;

ALTER TABLE sentinel_journal_cash_events
  ADD COLUMN IF NOT EXISTS event_kind TEXT DEFAULT 'adjustment';
