/**
 * Append-only tables for the research-backed daily setups (Don, 20 Nov 2026: nothing is ever deleted).
 *
 * setup_scan_runs       one row per (setup, market date) the job finished: how many symbols it scanned, how many
 *                       hits, what it skipped and why, and that day's market label. "Scanned, nothing hit" is a row.
 * setup_leader_shakeout one row per hit with the numbers behind it.
 *
 * Rows are only INSERTed, ON CONFLICT DO NOTHING on the unique key, so a re-run or a restart writes nothing twice.
 * Nothing here updates, deletes or prunes. A changed rule gets a new rule_version and its rows sit beside the old.
 */
import { sql } from "drizzle-orm";
import type { ShakeoutNumbers } from "./leader-shakeout";
import type { StopLevels } from "./stop-levels";
import type { Grade, GradeSettings } from "./grades";

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS setup_scan_runs (id SERIAL PRIMARY KEY, setup TEXT NOT NULL, rule_version TEXT NOT NULL, market_date TEXT NOT NULL, symbols_scanned INTEGER NOT NULL, hits INTEGER NOT NULL, skipped JSONB NOT NULL DEFAULT '{}'::jsonb, market_label TEXT, market_inputs JSONB, source TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (setup, rule_version, market_date))`,
  `CREATE INDEX IF NOT EXISTS idx_setup_scan_runs_date ON setup_scan_runs (setup, market_date)`,
  `CREATE TABLE IF NOT EXISTS setup_leader_shakeout (id SERIAL PRIMARY KEY, rule_version TEXT NOT NULL, market_date TEXT NOT NULL, symbol TEXT NOT NULL, close DOUBLE PRECISION NOT NULL, prev_close DOUBLE PRECISION NOT NULL, open DOUBLE PRECISION NOT NULL, volume DOUBLE PRECISION NOT NULL, drop_pct DOUBLE PRECISION NOT NULL, drop_atr DOUBLE PRECISION NOT NULL, atr14_prev DOUBLE PRECISION NOT NULL, rel_volume DOUBLE PRECISION NOT NULL, avg_vol20_prev DOUBLE PRECISION NOT NULL, run20 DOUBLE PRECISION NOT NULL, rsi2 DOUBLE PRECISION NOT NULL, dollar_vol20_prev DOUBLE PRECISION NOT NULL, gap_atr DOUBLE PRECISION NOT NULL, liquid BOOLEAN NOT NULL, gapped BOOLEAN NOT NULL, themes JSONB NOT NULL DEFAULT '[]'::jsonb, themes_as_of TEXT, market_label TEXT, mf_regime TEXT, source TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (rule_version, market_date, symbol))`,
  `CREATE INDEX IF NOT EXISTS idx_setup_leader_shakeout_date ON setup_leader_shakeout (market_date)`,
  // grade and stop levels (rule version S1-2026-11-20-g1); rows of the first version keep NULL here
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS grade TEXT`,
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS grade_settings JSONB`,
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS vwap DOUBLE PRECISION`,
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS stop_levels JSONB`,
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS stop_first TEXT`,
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS stop_first_dist_pct DOUBLE PRECISION`,
  `ALTER TABLE setup_leader_shakeout ADD COLUMN IF NOT EXISTS no_stop_inside_5 BOOLEAN`,
];

export interface RunRow {
  setup: string;
  ruleVersion: string;
  marketDate: string;
  symbolsScanned: number;
  hits: number;
  skipped: Record<string, unknown>;
  marketLabel: string | null;
  marketInputs: object | null;
  source: "daily" | "backfill" | "manual";
}

export interface ShakeoutRow extends ShakeoutNumbers {
  symbol: string;
  ruleVersion: string;
  themes: { id: string; name: string }[];
  themesAsOf: string | null;
  marketLabel: string | null;
  mfRegime: string | null;
  source: RunRow["source"];
  grade: Grade;
  gradeSettings: GradeSettings;
  vwap: number | null;
  stops: StopLevels;
}

export interface SetupStore {
  doneDates(setup: string, ruleVersion: string): Promise<Set<string>>;
  insertShakeouts(rows: ShakeoutRow[]): Promise<number>;
  insertRun(row: RunRow): Promise<number>;
}

type Exec = { execute: (q: any) => Promise<any> };
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);
export const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
let ensured = false;

export async function ensureSetupTables(db: Exec): Promise<void> {
  if (ensured) return;
  for (const stmt of DDL) await db.execute(sql.raw(stmt));
  ensured = true;
}

export function pgSetupStore(db: Exec): SetupStore {
  return {
    async doneDates(setup, ruleVersion) {
      await ensureSetupTables(db);
      const r = await db.execute(sql`SELECT market_date FROM setup_scan_runs WHERE setup = ${setup} AND rule_version = ${ruleVersion}`);
      return new Set(rowsOf(r).map((x) => String(x.market_date)));
    },
    async insertShakeouts(rows) {
      if (!rows.length) return 0;
      await ensureSetupTables(db);
      let n = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const values = rows.slice(i, i + 200).map(
          (r) => sql`(${r.ruleVersion}, ${r.date}, ${r.symbol}, ${r.close}, ${r.prevClose}, ${r.open}, ${r.volume}, ${r.ret}, ${r.dropAtr}, ${r.atr14Prev}, ${r.relVol}, ${r.avgVol20Prev}, ${r.run20}, ${r.rsi2}, ${r.dollarVol20Prev}, ${r.gapAtr}, ${r.liquid}, ${r.gapped}, ${JSON.stringify(r.themes)}::jsonb, ${r.themesAsOf}, ${r.marketLabel}, ${r.mfRegime}, ${r.source}, ${r.grade}, ${JSON.stringify(r.gradeSettings)}::jsonb, ${r.vwap}, ${JSON.stringify(r.stops.levels)}::jsonb, ${r.stops.first}, ${r.stops.firstDistPct}, ${r.stops.noStopInside5})`,
        );
        n += affected(
          await db.execute(
            sql`INSERT INTO setup_leader_shakeout (rule_version, market_date, symbol, close, prev_close, open, volume, drop_pct, drop_atr, atr14_prev, rel_volume, avg_vol20_prev, run20, rsi2, dollar_vol20_prev, gap_atr, liquid, gapped, themes, themes_as_of, market_label, mf_regime, source, grade, grade_settings, vwap, stop_levels, stop_first, stop_first_dist_pct, no_stop_inside_5) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (rule_version, market_date, symbol) DO NOTHING`,
          ),
        );
      }
      return n;
    },
    async insertRun(r) {
      await ensureSetupTables(db);
      return affected(
        await db.execute(
          sql`INSERT INTO setup_scan_runs (setup, rule_version, market_date, symbols_scanned, hits, skipped, market_label, market_inputs, source) VALUES (${r.setup}, ${r.ruleVersion}, ${r.marketDate}, ${r.symbolsScanned}, ${r.hits}, ${JSON.stringify(r.skipped)}::jsonb, ${r.marketLabel}, ${r.marketInputs ? JSON.stringify(r.marketInputs) : null}::jsonb, ${r.source}) ON CONFLICT (setup, rule_version, market_date) DO NOTHING`,
        ),
      );
    },
  };
}
