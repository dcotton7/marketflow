/**
 * The scan pool (Don, 20 Nov 2026: "expand the universe to cover them all", "volume to be 50m+").
 *
 * Every US-listed common stock (NYSE, NASDAQ) with market cap >= $1B, price >= $6 and average traded value
 * (average volume x price) >= $50M a day. Source: FMP /stable/company-screener (the key already in use), refreshed weekly.
 *
 * Kept apart from the themes: pool names live in their own table (scan_pool), not in `tickers`, so they join no
 * theme, are not in the 1-minute snapshot polling, and do not enter the regime or theme readings. They get daily
 * bars (the bar job and the backfill take universe + active pool) and the scans that read historical_bars see them.
 *
 * Rules:
 *   - nothing is deleted: a name that falls out is marked inactive (inactive_since) and its bars stay; it simply
 *     stops being refreshed. A name that returns is reactivated.
 *   - hysteresis: a name enters at the full floor and leaves only below 80% of it, so one that hovers at $50M does not
 *     flip every week and leave holes in its bars.
 *   - a partial answer from the vendor (fewer than 600 rows, or under half of the active pool) deactivates nothing.
 *
 * The planning is pure (planPoolRefresh) and tested; the vendor call and the writes are thin.
 */
import { sql } from "drizzle-orm";

export const POOL_MIN_CAP = 1e9;
export const POOL_MIN_PRICE = 6;
export const POOL_MIN_DOLLAR_VOL = 50e6;
/** A member stays until it is below this share of every floor. */
export const POOL_KEEP_SHARE = 0.8;
export const MIN_SCREENER_ROWS = 600;
export const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export interface PoolCandidate {
  symbol: string;
  companyName: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number;
  price: number;
  avgDollarVol: number;
}

export interface StoredPool {
  symbol: string;
  active: boolean;
}

/** A US common-stock looking ticker: AAPL, BRK.B (FMP's BRK-B is stored the way the rest of MarketFlow spells it). Warrants, rights, units and preferreds are left out. */
export function normalizePoolSymbol(raw: string): string | null {
  const s = String(raw ?? "").trim().toUpperCase().replace("-", ".");
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return null;
  if (/^[A-Z]{4}[WRU]$/.test(s)) return null; // warrant / right / unit
  return s;
}

export function parseScreenerRows(body: unknown): PoolCandidate[] {
  if (!Array.isArray(body)) return [];
  const out: PoolCandidate[] = [];
  for (const r of body as any[]) {
    if (!r || r.isEtf === true || r.isFund === true) continue;
    const symbol = normalizePoolSymbol(r.symbol);
    const marketCap = Number(r.marketCap);
    const price = Number(r.price);
    const avgVolume = Number(r.avgVolume);
    if (!symbol || !(marketCap > 0) || !(price > 0) || !(avgVolume >= 0)) continue;
    out.push({
      symbol,
      companyName: r.companyName ? String(r.companyName) : null,
      exchange: r.exchangeShortName ? String(r.exchangeShortName) : null,
      sector: r.sector ? String(r.sector) : null,
      industry: r.industry ? String(r.industry) : null,
      marketCap,
      price,
      avgDollarVol: avgVolume * price,
    });
  }
  return out;
}

export function meetsFloor(c: PoolCandidate, share = 1): boolean {
  const f = share - 1e-9; // 0.8 x 6 is 4.800000000000001: a name exactly at the band must count
  return c.marketCap >= POOL_MIN_CAP * f && c.price >= POOL_MIN_PRICE * f && c.avgDollarVol >= POOL_MIN_DOLLAR_VOL * f;
}

export interface PoolPlan {
  /** names not seen before, meeting the full floor */
  added: PoolCandidate[];
  /** inactive names back above the full floor */
  reactivated: PoolCandidate[];
  /** active names still above the keep band: new numbers written */
  kept: PoolCandidate[];
  /** active names below the keep band, or no longer returned: marked inactive, bars stay */
  deactivated: string[];
  guard: string | null;
}

export function planPoolRefresh(stored: StoredPool[], rows: PoolCandidate[]): PoolPlan {
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const storedBy = new Map(stored.map((s) => [s.symbol, s]));
  const activeStored = stored.filter((s) => s.active);
  const added: PoolCandidate[] = [];
  const reactivated: PoolCandidate[] = [];
  const kept: PoolCandidate[] = [];
  const deactivated: string[] = [];

  let guard: string | null = null;
  if (rows.length < MIN_SCREENER_ROWS) guard = `vendor returned ${rows.length} rows (fewer than ${MIN_SCREENER_ROWS}): nothing deactivated`;

  for (const r of rows) {
    const st = storedBy.get(r.symbol);
    if (!st) {
      if (meetsFloor(r)) added.push(r);
    } else if (st.active) {
      if (meetsFloor(r, POOL_KEEP_SHARE)) kept.push(r);
    } else if (meetsFloor(r)) {
      reactivated.push(r);
    }
  }
  const keptSet = new Set(kept.map((k) => k.symbol));
  const wouldDeactivate = activeStored.filter((s) => !keptSet.has(s.symbol)).map((s) => s.symbol);
  if (!guard && activeStored.length > 0 && wouldDeactivate.length > activeStored.length / 2) {
    guard = `${wouldDeactivate.length} of ${activeStored.length} active names would drop out: looks like a partial answer, nothing deactivated`;
  }
  if (!guard) deactivated.push(...wouldDeactivate);
  void bySym;
  return { added, reactivated, kept, deactivated, guard };
}

export const POOL_DDL = [
  `CREATE TABLE IF NOT EXISTS scan_pool (
     symbol TEXT PRIMARY KEY, company_name TEXT, exchange TEXT, sector TEXT, industry TEXT,
     market_cap DOUBLE PRECISION, price DOUBLE PRECISION, avg_dollar_vol DOUBLE PRECISION,
     in_universe BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE,
     first_seen DATE NOT NULL, last_qualified DATE, inactive_since DATE, refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];

function rowsOf(r: any): any[] {
  return r?.rows ?? (Array.isArray(r) ? r : []);
}

export async function ensurePoolTable(db: any): Promise<void> {
  for (const q of POOL_DDL) await db.execute(sql.raw(q));
}

/** Active pool symbols; [] when the table does not exist yet (before the first refresh). */
export async function loadActivePoolSymbols(db: any): Promise<string[]> {
  try {
    return rowsOf(await db.execute(sql`SELECT symbol FROM scan_pool WHERE active ORDER BY symbol`)).map((r) => String(r.symbol).toUpperCase());
  } catch {
    return [];
  }
}

export async function fetchScreenerRows(): Promise<PoolCandidate[]> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");
  // A little wider than the entry floor so the keep band can see names that slipped under it.
  const qs = new URLSearchParams({
    marketCapMoreThan: String(POOL_MIN_CAP * POOL_KEEP_SHARE),
    priceMoreThan: String(POOL_MIN_PRICE * POOL_KEEP_SHARE),
    isEtf: "false",
    isFund: "false",
    isActivelyTrading: "true",
    country: "US",
    exchange: "NYSE,NASDAQ",
    limit: "10000",
    apikey: key,
  });
  const r = await fetch(`https://financialmodelingprep.com/stable/company-screener?${qs}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`FMP screener answered ${r.status}`);
  return parseScreenerRows(await r.json());
}

export interface PoolRefreshResult {
  dryRun: boolean;
  screenerRows: number;
  active: { before: number; after: number };
  added: number;
  reactivated: number;
  kept: number;
  deactivated: string[];
  newNamesSample: string[];
  alreadyInUniverse: number;
  guard: string | null;
}

/** `universe` = the theme universe (static lists + tickers table), only to mark which pool names are new to MarketFlow. */
export async function refreshScanPool(db: any, opts: { dryRun?: boolean; universe: Set<string>; fetchRows?: () => Promise<PoolCandidate[]> }): Promise<PoolRefreshResult> {
  const dryRun = !!opts.dryRun;
  const rows = await (opts.fetchRows ?? fetchScreenerRows)();
  let stored: StoredPool[] = [];
  try {
    stored = rowsOf(await db.execute(sql`SELECT symbol, active FROM scan_pool`)).map((r) => ({ symbol: String(r.symbol), active: !!r.active }));
  } catch {
    stored = []; // table not created yet
  }
  const plan = planPoolRefresh(stored, rows);
  const activeBefore = stored.filter((s) => s.active).length;
  const activeAfter = activeBefore + plan.added.length + plan.reactivated.length - plan.deactivated.length;
  const result: PoolRefreshResult = {
    dryRun,
    screenerRows: rows.length,
    active: { before: activeBefore, after: activeAfter },
    added: plan.added.length,
    reactivated: plan.reactivated.length,
    kept: plan.kept.length,
    deactivated: plan.deactivated,
    newNamesSample: plan.added.filter((a) => !opts.universe.has(a.symbol)).slice(0, 20).map((a) => a.symbol),
    alreadyInUniverse: [...plan.added, ...plan.reactivated, ...plan.kept].filter((a) => opts.universe.has(a.symbol)).length,
    guard: plan.guard,
  };
  if (dryRun) return result;

  await ensurePoolTable(db);
  const today = new Date().toISOString().slice(0, 10);
  const upserts = [...plan.added, ...plan.reactivated, ...plan.kept];
  for (let i = 0; i < upserts.length; i += 200) {
    const chunk = upserts.slice(i, i + 200);
    const values = chunk.map(
      (c) => sql`(${c.symbol}, ${c.companyName}, ${c.exchange}, ${c.sector}, ${c.industry}, ${c.marketCap}, ${c.price}, ${c.avgDollarVol}, ${opts.universe.has(c.symbol)}, TRUE, ${today}::date, ${today}::date, NULL, NOW())`
    );
    await db.execute(sql`INSERT INTO scan_pool (symbol, company_name, exchange, sector, industry, market_cap, price, avg_dollar_vol, in_universe, active, first_seen, last_qualified, inactive_since, refreshed_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (symbol) DO UPDATE SET company_name = EXCLUDED.company_name, exchange = EXCLUDED.exchange, sector = EXCLUDED.sector,
        industry = EXCLUDED.industry, market_cap = EXCLUDED.market_cap, price = EXCLUDED.price, avg_dollar_vol = EXCLUDED.avg_dollar_vol,
        in_universe = EXCLUDED.in_universe, active = TRUE, last_qualified = EXCLUDED.last_qualified, inactive_since = NULL, refreshed_at = NOW()`);
  }
  if (plan.deactivated.length) {
    await db.execute(sql`UPDATE scan_pool SET active = FALSE, inactive_since = ${today}::date, refreshed_at = NOW()
      WHERE symbol IN (${sql.join(plan.deactivated.map((s) => sql`${s}`), sql`, `)})`);
  }
  return result;
}

let schedulerStarted = false;

/** Weekly: a check every 6 hours runs the refresh when the last one is over 7 days old (or there is none). */
export function startScanPoolScheduler(getUniverse: () => Promise<Set<string>>, getDb: () => any): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = async () => {
    const db = getDb();
    if (!db) return;
    try {
      let last: number | null = null;
      try {
        const r = rowsOf(await db.execute(sql`SELECT MAX(refreshed_at) AS t FROM scan_pool`));
        last = r[0]?.t ? new Date(r[0].t).getTime() : null;
      } catch {
        last = null;
      }
      if (last && Date.now() - last < REFRESH_EVERY_MS) return;
      const res = await refreshScanPool(db, { universe: await getUniverse() });
      console.log(`[ScanPool] refreshed: ${res.screenerRows} screener rows, +${res.added} new, ${res.reactivated} back, ${res.deactivated.length} out, active ${res.active.after}${res.guard ? ` (${res.guard})` : ""}`);
    } catch (err) {
      console.error("[ScanPool] refresh failed (non-fatal):", String(err).slice(0, 200));
    }
  };
  setTimeout(() => void tick(), 5 * 60_000);
  setInterval(() => void tick(), 6 * 60 * 60 * 1000);
  console.log("[ScanPool] Scheduler started - first check in 5 min, then every 6 h (refreshes when the last run is over 7 days old).");
}
