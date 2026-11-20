/**
 * Backfill of daily bars for universe names that have none or stopped (see bar-universe.ts for the universe).
 *
 * Rules (Don: data is never deleted):
 *   - inserts only: ON CONFLICT (symbol, bar_date) DO NOTHING. An existing bar is never changed or removed.
 *   - safe to run again: a second run finds the same names, inserts only dates still missing (normally zero).
 *   - one symbol in memory at a time (about 650 bars), written in chunks of 500.
 *   - paced: one vendor request at a time with a pause, far below Alpaca's 200 requests/minute; 429s are retried by alpaca.ts.
 *   - the current session's bar is not stored while it is still developing (same rule as the daily job).
 *   - a ticker the vendor does not serve is listed by name with the reason; it is not an error.
 *
 * The plan (which names, how many) is pure and tested; the run takes its fetcher and inserter as arguments.
 */
import { sql } from "drizzle-orm";
import { getEtClock, getUsEquityMarketSession } from "@shared/usEquityMarketSession";
import { normalizeSymbol } from "./bar-universe";

export const DEFAULT_FROM = "2024-06-01";
export const INSERT_CHUNK = 500;

export interface BarStat { min: string; max: string; count: number }

export interface BackfillPlan {
  universe: number;
  latestSession: string;
  withLatest: number;
  targets: string[];
  noBarsAtAll: string[];
  stopped: string[];
  from: string;
  /** Targets that have bars but start later than `from` (history before their first bar is also filled). */
  shallow: number;
}

/** Latest stored session = newest bar date anywhere in the table. Targets = universe names without a bar on it. */
export function planBackfill(universe: string[], stats: Map<string, BarStat>, opts: { from?: string; only?: string[] } = {}): BackfillPlan {
  const from = opts.from ?? DEFAULT_FROM;
  let latest = "";
  for (const st of stats.values()) if (st.max > latest) latest = st.max;
  const only = opts.only ? new Set(opts.only.map(normalizeSymbol)) : null;
  const targets: string[] = [];
  const noBarsAtAll: string[] = [];
  const stopped: string[] = [];
  let withLatest = 0;
  let shallow = 0;
  // A first bar a few days after `from` is just a weekend or holiday, not missing history.
  const shallowCutoff = new Date(new Date(`${from}T12:00:00Z`).getTime() + 10 * 864e5).toISOString().slice(0, 10);
  for (const sym of universe) {
    const st = stats.get(sym);
    const hasLatest = !!st && st.max >= latest;
    if (hasLatest) withLatest++;
    if (only ? !only.has(sym) : hasLatest) continue;
    targets.push(sym);
    if (!st) noBarsAtAll.push(sym);
    else {
      stopped.push(sym);
      if (st.min > shallowCutoff) shallow++;
    }
  }
  return { universe: universe.length, latestSession: latest, withLatest, targets, noBarsAtAll, stopped, from, shallow };
}

export async function loadBarStats(db: any): Promise<Map<string, BarStat>> {
  const res: any = await db.execute(
    sql`SELECT symbol, MIN(bar_date)::text AS mn, MAX(bar_date)::text AS mx, COUNT(*)::int AS c FROM historical_bars GROUP BY symbol`
  );
  const rows: any[] = res?.rows ?? (Array.isArray(res) ? res : []);
  const m = new Map<string, BarStat>();
  for (const r of rows) {
    m.set(normalizeSymbol(String(r.symbol)), { min: String(r.mn).slice(0, 10), max: String(r.mx).slice(0, 10), count: Number(r.c) });
  }
  return m;
}

export interface FetchedBar { date: string; open: number; high: number; low: number; close: number; volume: number }
export type BarFetcher = (symbol: string, from: Date, to: Date) => Promise<FetchedBar[]>;

export interface SymbolResult {
  symbol: string;
  fetched: number;
  inserted: number;
  /** Set when the vendor gave nothing: "no bars returned" or the error text. */
  unserved?: string;
}

export interface InsertRow { symbol: string; barDate: string; open: string; high: string; low: string; close: string; volume: number }

/** Rows for one symbol, minus the bar of a session still in progress. Pure. */
export function rowsForInsert(symbol: string, bars: FetchedBar[], now: Date = new Date()): InsertRow[] {
  const today = getEtClock(now).dateKey;
  const session = getUsEquityMarketSession(now);
  const out: InsertRow[] = [];
  const seen = new Set<string>();
  for (const b of bars) {
    const barDate = getEtClock(new Date(b.date)).dateKey;
    if (barDate === today && (session === "pre_market" || session === "regular")) continue;
    if (seen.has(barDate)) continue;
    seen.add(barDate);
    out.push({
      symbol: normalizeSymbol(symbol),
      barDate,
      open: String(b.open),
      high: String(b.high),
      low: String(b.low),
      close: String(b.close),
      volume: Math.round(b.volume || 0),
    });
  }
  return out;
}

/** Writes one chunk with ON CONFLICT DO NOTHING and returns how many rows were new. Injectable for tests. */
export type ChunkInserter = (rows: InsertRow[]) => Promise<number>;

export async function backfillSymbol(
  symbol: string,
  from: Date,
  to: Date,
  fetchBars: BarFetcher,
  insertChunk: ChunkInserter,
  now: Date = new Date()
): Promise<SymbolResult> {
  let bars: FetchedBar[];
  try {
    bars = await fetchBars(symbol, from, to);
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 160);
    if (/\b(401|403)\b/.test(msg)) throw err; // credentials: stop the whole run, not one name
    return { symbol, fetched: 0, inserted: 0, unserved: msg };
  }
  if (bars.length === 0) return { symbol, fetched: 0, inserted: 0, unserved: "no bars returned" };
  const rows = rowsForInsert(symbol, bars, now);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) inserted += await insertChunk(rows.slice(i, i + INSERT_CHUNK));
  return { symbol, fetched: bars.length, inserted };
}
