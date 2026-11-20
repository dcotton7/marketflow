/**
 * One compact end-of-day summary row per symbol (theme names and scan pool names alike), built once a day after the
 * daily bar job, kept in the table `ticker_daily_summary` and in a small in-memory map. It is what the screen route
 * (R7, screen.ts) serves pool-only names from and joins to the live snapshot for theme names. The route never reads
 * bars, and nothing here holds more than one batch of bars at a time (150 names x about 300 bars).
 *
 * "Prior" rules (a row's own day is as_of for end-of-day rows, today for live rows):
 *   base_high_prior = highest high of the 30 sessions BEFORE as_of            (use this for an end-of-day row)
 *   base_high_incl  = highest high of the 30 sessions THROUGH as_of           (use this for a live row on a later day)
 */
import { sql } from "drizzle-orm";
import { bucketOf, normalizeCapSize } from "./utils/cap-size";
import { logPhase } from "../infra/job-guard";

export const BASE_SESSIONS = 30;
export const BAR_LOOKBACK_DAYS = 330; // calendar days: enough for a 200-day average
export const BATCH = 150;

export interface DayBar { date: string; open: number; high: number; low: number; close: number; volume: number }

export interface DailySummary {
  symbol: string;
  asOf: string; // date of the newest stored bar
  close: number;
  high: number;
  low: number;
  volume: number;
  prevClose: number | null;
  prevHigh: number | null;
  prevLow: number | null;
  ema10: number | null;
  ema20: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  adr20: number | null; // average (high/low - 1) in %, 20 sessions
  baseHighPrior: number | null;
  baseHighIncl: number | null;
  avgVolume20: number | null; // 20 sessions through as_of
  avgDollarVol20: number | null;
  volExp: number | null; // as_of volume / average volume of the 20 sessions before it
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  capSize: string | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function sma(closes: number[], n: number): number | null {
  return closes.length >= n ? mean(closes.slice(-n)) : null;
}

/** Standard EMA seeded with the first n-day average. */
function ema(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const k = 2 / (n + 1);
  let e = mean(closes.slice(0, n));
  for (let i = n; i < closes.length; i++) e = closes[i]! * k + e * (1 - k);
  return e;
}

/** Pure: bars oldest first -> the summary numbers (profile fields are filled by the caller). null under 21 bars. */
export function summarizeBars(symbol: string, bars: DayBar[]): DailySummary | null {
  if (bars.length < 21) return null;
  const n = bars.length;
  const last = bars[n - 1]!;
  const prev = bars[n - 2]!;
  const closes = bars.map((b) => b.close);
  const last20 = bars.slice(-20);
  const before20 = bars.slice(-21, -1);
  const baseThrough = bars.slice(-BASE_SESSIONS);
  const basePrior = bars.slice(-BASE_SESSIONS - 1, -1);
  const prior = before20.reduce((a, b) => a + b.volume, 0) / before20.length;
  return {
    symbol,
    asOf: last.date,
    close: last.close,
    high: last.high,
    low: last.low,
    volume: last.volume,
    prevClose: prev.close,
    prevHigh: prev.high,
    prevLow: prev.low,
    ema10: ema(closes, 10),
    ema20: ema(closes, 20),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    adr20: mean(last20.map((b) => (b.low > 0 ? (b.high / b.low - 1) * 100 : 0))),
    baseHighPrior: basePrior.length >= 10 ? Math.max(...basePrior.map((b) => b.high)) : null,
    baseHighIncl: baseThrough.length >= 10 ? Math.max(...baseThrough.map((b) => b.high)) : null,
    avgVolume20: mean(last20.map((b) => b.volume)),
    avgDollarVol20: mean(last20.map((b) => b.close * b.volume)),
    volExp: prior > 0 ? last.volume / prior : null,
    sector: null,
    industry: null,
    marketCap: null,
    capSize: null,
  };
}

export const SUMMARY_DDL = [
  `CREATE TABLE IF NOT EXISTS ticker_daily_summary (
     symbol TEXT PRIMARY KEY, as_of DATE NOT NULL, close DOUBLE PRECISION, high DOUBLE PRECISION, low DOUBLE PRECISION, volume DOUBLE PRECISION,
     prev_close DOUBLE PRECISION, prev_high DOUBLE PRECISION, prev_low DOUBLE PRECISION,
     ema10 DOUBLE PRECISION, ema20 DOUBLE PRECISION, sma20 DOUBLE PRECISION, sma50 DOUBLE PRECISION, sma200 DOUBLE PRECISION, adr20 DOUBLE PRECISION,
     base_high_prior DOUBLE PRECISION, base_high_incl DOUBLE PRECISION, avg_volume20 DOUBLE PRECISION, avg_dollar_vol20 DOUBLE PRECISION, vol_exp DOUBLE PRECISION,
     sector TEXT, industry TEXT, market_cap DOUBLE PRECISION, cap_size TEXT, built_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];

const rowsOf = (r: any): any[] => r?.rows ?? (Array.isArray(r) ? r : []);
let map: Map<string, DailySummary> | null = null;
let loadedAt = 0;

export async function ensureSummaryTable(db: any): Promise<void> {
  for (const q of SUMMARY_DDL) await db.execute(sql.raw(q));
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function fromRow(r: any): DailySummary {
  return {
    symbol: String(r.symbol),
    asOf: String(r.as_of).slice(0, 10),
    close: Number(r.close), high: Number(r.high), low: Number(r.low), volume: Number(r.volume),
    prevClose: num(r.prev_close), prevHigh: num(r.prev_high), prevLow: num(r.prev_low),
    ema10: num(r.ema10), ema20: num(r.ema20), sma20: num(r.sma20), sma50: num(r.sma50), sma200: num(r.sma200), adr20: num(r.adr20),
    baseHighPrior: num(r.base_high_prior), baseHighIncl: num(r.base_high_incl),
    avgVolume20: num(r.avg_volume20), avgDollarVol20: num(r.avg_dollar_vol20), volExp: num(r.vol_exp),
    sector: r.sector ?? null, industry: r.industry ?? null, marketCap: num(r.market_cap), capSize: normalizeCapSize(r.cap_size),
  };
}

/** The in-memory map (about 1,800 small rows). Read from the table on first use and again after 6 hours. */
export async function getSummaryMap(db: any, now = Date.now()): Promise<Map<string, DailySummary>> {
  if (map && now - loadedAt < 6 * 3600_000) return map;
  const m = new Map<string, DailySummary>();
  try {
    for (const r of rowsOf(await db.execute(sql`SELECT * FROM ticker_daily_summary`))) m.set(String(r.symbol).toUpperCase(), fromRow(r));
  } catch {
    // table not built yet: an empty map, the route says so
  }
  map = m;
  loadedAt = now;
  return m;
}

export function setSummaryMapForTests(m: Map<string, DailySummary> | null): void {
  map = m;
  loadedAt = Date.now();
}

async function loadProfiles(db: any): Promise<Map<string, { sector: string | null; industry: string | null; marketCap: number | null; capSize: string | null }>> {
  const out = new Map<string, { sector: string | null; industry: string | null; marketCap: number | null; capSize: string | null }>();
  try {
    for (const r of rowsOf(await db.execute(sql`SELECT symbol, sector, industry, market_cap, market_cap_size FROM tickers`))) {
      out.set(String(r.symbol).toUpperCase(), { sector: r.sector ?? null, industry: r.industry ?? null, marketCap: num(r.market_cap), capSize: normalizeCapSize(r.market_cap_size) });
    }
  } catch { /* none */ }
  try {
    // pool names (not in tickers): from the weekly screener
    for (const r of rowsOf(await db.execute(sql`SELECT symbol, sector, industry, market_cap FROM scan_pool`))) {
      const sym = String(r.symbol).toUpperCase();
      if (out.has(sym) && out.get(sym)!.marketCap) continue;
      const cap = num(r.market_cap);
      out.set(sym, { sector: r.sector ?? null, industry: r.industry ?? null, marketCap: cap, capSize: cap ? bucketOf(cap) : null });
    }
  } catch { /* no pool yet */ }
  return out;
}

export interface BuildResult { symbols: number; summarized: number; skipped: number; asOf: string | null }

/** Build and store the summaries for `symbols`: one batch of bars in memory at a time, upserted per batch. */
export async function buildDailySummaries(db: any, symbols: string[], opts: { shouldStop?: () => boolean } = {}): Promise<BuildResult> {
  await ensureSummaryTable(db);
  const profiles = await loadProfiles(db);
  let summarized = 0;
  let skipped = 0;
  let asOf: string | null = null;
  const cutoff = new Date(Date.now() - BAR_LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < symbols.length; i += BATCH) {
    if (opts.shouldStop?.()) break;
    const batch = symbols.slice(i, i + BATCH);
    const res = rowsOf(await db.execute(sql`SELECT symbol, bar_date::text AS d, open::float8 AS o, high::float8 AS h, low::float8 AS l, close::float8 AS c, volume::float8 AS v
      FROM historical_bars WHERE symbol IN (${sql.join(batch.map((s) => sql`${s}`), sql`, `)}) AND bar_date >= ${cutoff} ORDER BY symbol, bar_date`));
    const by = new Map<string, DayBar[]>();
    for (const r of res) {
      const s = String(r.symbol).toUpperCase();
      if (!by.has(s)) by.set(s, []);
      by.get(s)!.push({ date: String(r.d), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: Number(r.v) });
    }
    const rows: DailySummary[] = [];
    for (const sym of batch) {
      const sm = summarizeBars(sym, by.get(sym) ?? []);
      if (!sm) { skipped++; continue; }
      const p = profiles.get(sym);
      if (p) Object.assign(sm, p);
      rows.push(sm);
      if (!asOf || sm.asOf > asOf) asOf = sm.asOf;
    }
    for (let k = 0; k < rows.length; k += 100) {
      const chunk = rows.slice(k, k + 100);
      const vals = chunk.map((s) => sql`(${s.symbol}, ${s.asOf}::date, ${s.close}, ${s.high}, ${s.low}, ${s.volume}, ${s.prevClose}, ${s.prevHigh}, ${s.prevLow}, ${s.ema10}, ${s.ema20}, ${s.sma20}, ${s.sma50}, ${s.sma200}, ${s.adr20}, ${s.baseHighPrior}, ${s.baseHighIncl}, ${s.avgVolume20}, ${s.avgDollarVol20}, ${s.volExp}, ${s.sector}, ${s.industry}, ${s.marketCap}, ${s.capSize}, NOW())`);
      await db.execute(sql`INSERT INTO ticker_daily_summary (symbol, as_of, close, high, low, volume, prev_close, prev_high, prev_low, ema10, ema20, sma20, sma50, sma200, adr20, base_high_prior, base_high_incl, avg_volume20, avg_dollar_vol20, vol_exp, sector, industry, market_cap, cap_size, built_at)
        VALUES ${sql.join(vals, sql`, `)}
        ON CONFLICT (symbol) DO UPDATE SET as_of = EXCLUDED.as_of, close = EXCLUDED.close, high = EXCLUDED.high, low = EXCLUDED.low, volume = EXCLUDED.volume,
          prev_close = EXCLUDED.prev_close, prev_high = EXCLUDED.prev_high, prev_low = EXCLUDED.prev_low, ema10 = EXCLUDED.ema10, ema20 = EXCLUDED.ema20,
          sma20 = EXCLUDED.sma20, sma50 = EXCLUDED.sma50, sma200 = EXCLUDED.sma200, adr20 = EXCLUDED.adr20, base_high_prior = EXCLUDED.base_high_prior,
          base_high_incl = EXCLUDED.base_high_incl, avg_volume20 = EXCLUDED.avg_volume20, avg_dollar_vol20 = EXCLUDED.avg_dollar_vol20, vol_exp = EXCLUDED.vol_exp,
          sector = EXCLUDED.sector, industry = EXCLUDED.industry, market_cap = EXCLUDED.market_cap, cap_size = EXCLUDED.cap_size, built_at = NOW()`);
      summarized += chunk.length;
    }
    logPhase("DailySummary", `batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(symbols.length / BATCH)} (${summarized} rows)`);
  }
  map = null; // re-read the table on the next request
  return { symbols: symbols.length, summarized, skipped, asOf };
}

/**
 * Once a day, after the bar job: build when fewer than 90% of the universe have a summary through `expectedSession`. Returns the build result, or null when it is up to date.
 */
export async function ensureDailySummary(db: any, expectedSession: string, universe: string[], opts: { shouldStop?: () => boolean } = {}): Promise<BuildResult | null> {
  let current = 0;
  try {
    const r = rowsOf(await db.execute(sql`SELECT COUNT(*) FILTER (WHERE as_of >= ${expectedSession}::date)::int AS n FROM ticker_daily_summary`));
    current = Number(r[0]?.n ?? 0);
  } catch {
    current = 0;
  }
  if (current >= 0.9 * universe.length) return null;
  const res = await buildDailySummaries(db, universe, opts);
  console.log(`[DailySummary] built ${res.summarized}/${res.symbols} rows (${res.skipped} too short), as of ${res.asOf}`);
  return res;
}
