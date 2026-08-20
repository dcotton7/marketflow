-- Migration 025: widen scanner_discoveries.subject
--
-- subject holds a ticker for ticker signals and a theme id for theme signals.
-- It was varchar(16), but four theme ids are longer than that:
--
--   HOSPITALITY_LEISURE  19
--   DATA_CENTER_REITS    17
--   HIGH_BETA_OVERLAY    17
--   SMALL_CAP_OVERLAY    17
--
-- Signals for those four themes were rejected by Postgres, and because
-- discoveries are written a batch at a time in a single INSERT, one rejected
-- row aborted the whole statement and took every healthy signal in that batch
-- with it. The four themes have never appeared in the table, and total volume
-- ran well under half of normal on days when they fired often.
--
-- 64 matches theme_id, which already holds the same identifiers.
--
-- Widening a varchar is a metadata-only change in Postgres: no rewrite, no
-- table scan, no lock beyond a brief ACCESS EXCLUSIVE. No row is modified and
-- nothing is deleted.

ALTER TABLE scanner_discoveries
  ALTER COLUMN subject TYPE varchar(64);
