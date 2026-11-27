-- Migration 031: trend facts on each trigger candidate (docs/trigger-scanner.md, "Trend facts"; Don, 27 Nov). One
-- nullable JSONB column; rows stored before it read as null ("not known"). ADD COLUMN IF NOT EXISTS with no default
-- is a catalogue-only change in Postgres (no table rewrite, a brief lock), safe on the live table.
-- server/trigger-scanner/store.ts runs the same statement before its first write or read, so no manual step is needed.

ALTER TABLE trigger_candidates ADD COLUMN IF NOT EXISTS trend JSONB;
