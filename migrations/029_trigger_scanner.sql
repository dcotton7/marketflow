-- Migration 029: the trigger scanner (server/trigger-scanner, docs/trigger-scanner.md). Append-only: nothing in the
-- app updates, deletes or prunes these tables; every write is an INSERT ... ON CONFLICT DO NOTHING on the unique key.
-- server/trigger-scanner/store.ts runs the same statements (CREATE ... IF NOT EXISTS) before its first write or read,
-- and only when TRIGGER_SCANNER=on, so no manual step is needed on deploy and nothing exists while the flag is off.
-- Keep the two in step. Growth (estimate): trigger_candidates under 1 MB/day, trigger_scan_runs 78 rows/day.
-- trigger_user_setups is versioned: an edit is a new row (version + 1), switching a setup off is a new row with
-- active = false; the newest version per (owner_user_id, setup_key) is the one in force.

CREATE TABLE IF NOT EXISTS trigger_candidates (id SERIAL PRIMARY KEY, market_date TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, setup_key TEXT NOT NULL, setup_owner TEXT NOT NULL DEFAULT 'builtin', owner_user_id INTEGER, variant TEXT NOT NULL, why TEXT NOT NULL, trigger_at TIMESTAMPTZ NOT NULL, bar JSONB NOT NULL, entry_ref DOUBLE PRECISION NOT NULL, stop_level TEXT NOT NULL, stop_level_price DOUBLE PRECISION NOT NULL, stop_price DOUBLE PRECISION NOT NULL, stop_gap JSONB, risk_pct DOUBLE PRECISION NOT NULL, risk_adr DOUBLE PRECISION NOT NULL, adr_pct DOUBLE PRECISION NOT NULL, levels JSONB NOT NULL, rel_volume DOUBLE PRECISION, liquidity JSONB NOT NULL, regime JSONB NOT NULL, cap_size TEXT, sector TEXT, group_leading BOOLEAN NOT NULL, rotation JSONB NOT NULL, grade TEXT NOT NULL, grade_points INTEGER NOT NULL, grade_components JSONB NOT NULL, data_as_of JSONB NOT NULL, facts JSONB NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, rule_version TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS idx_trigger_candidates_date ON trigger_candidates (market_date, id);

CREATE TABLE IF NOT EXISTS trigger_scan_runs (id SERIAL PRIMARY KEY, market_date TEXT NOT NULL, pass_at TIMESTAMPTZ NOT NULL UNIQUE, tier TEXT NOT NULL, universe_size INTEGER NOT NULL, symbols_scanned INTEGER NOT NULL, bars_evaluated INTEGER NOT NULL, requests INTEGER NOT NULL, bars_lag_sec INTEGER, triggers INTEGER NOT NULL, candidates INTEGER NOT NULL, deduped INTEGER NOT NULL, refused JSONB NOT NULL DEFAULT '{}'::jsonb, skipped JSONB NOT NULL DEFAULT '{}'::jsonb, paused TEXT, duration_ms INTEGER NOT NULL, rss_mb INTEGER, rule_version TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());

CREATE INDEX IF NOT EXISTS idx_trigger_scan_runs_date ON trigger_scan_runs (market_date, pass_at);

CREATE TABLE IF NOT EXISTS trigger_user_setups (id SERIAL PRIMARY KEY, owner_user_id INTEGER NOT NULL, setup_key TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, side TEXT NOT NULL, timeframe TEXT NOT NULL DEFAULT 'daily', idea_id INTEGER, criteria JSONB NOT NULL DEFAULT '[]'::jsonb, entry_rule TEXT NOT NULL, range_adr DOUBLE PRECISION, active BOOLEAN NOT NULL DEFAULT TRUE, source TEXT NOT NULL DEFAULT 'manual', created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (owner_user_id, setup_key, version));
