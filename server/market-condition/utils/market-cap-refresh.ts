/**
 * Market cap refresh for every ticker in the tickers table (Don, 20 Nov 2026: "run a market cap refresh across
 * MarketFlow's tickers").
 *
 * Source: FMP /stable/market-capitalization-batch on the FMP key in use (100 symbols a call, a second apart:
 * about 11 calls for the ~1,050 tickers). Finnhub /stock/metric (the key in use) is asked only as a second opinion
 * for a cap that moved more than 10x against the stored value.
 *
 * Rules:
 *   - one set of size boundaries (cap-size.ts bucketOf), applied here on write; the size filter and capSize read
 *     the stored bucket, so all three agree;
 *   - implausible caps are not written and are listed: zero or negative, above $10T, or more than 10x up or down
 *     against a plausible stored value unless Finnhub agrees within 25% (a split does not change a market cap);
 *   - history: each accepted cap is appended to market_cap_history (as_of, symbol, cap, bucket, source; never
 *     pruned), then the current tickers.market_cap / market_cap_size are updated. Nothing is deleted. A ticker the
 *     source does not return keeps its stored values.
 *   - dry run: the same plan, printed, with no table created and nothing written.
 */
import { sql } from "drizzle-orm";
import { bucketOf, BOUNDARIES, normalizeCapSize, resetCapSizeCacheForTests, type CapSize } from "./cap-size";

export const MAX_PLAUSIBLE_CAP = 10e12;
export const MAX_RATIO = 10;
export const SECOND_OPINION_TOLERANCE = 0.25;

export const DDL = [
  `CREATE TABLE IF NOT EXISTS market_cap_history (id SERIAL PRIMARY KEY, as_of DATE NOT NULL, symbol TEXT NOT NULL, market_cap DOUBLE PRECISION NOT NULL, bucket TEXT NOT NULL, source TEXT NOT NULL, boundaries JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (as_of, symbol, source))`,
  `CREATE INDEX IF NOT EXISTS idx_market_cap_history_symbol ON market_cap_history (symbol, as_of)`,
];

export interface Stored { symbol: string; marketCap: number | null; bucket: CapSize | null }
export interface Accepted { symbol: string; oldCap: number | null; newCap: number; oldBucket: CapSize | null; newBucket: CapSize; source: string; note?: string }
export interface Rejected { symbol: string; storedCap: number | null; sourceCap: number; reason: string }

const plausible = (x: number | null): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= MAX_PLAUSIBLE_CAP;

/** Accept or reject one fetched cap. `second` is Finnhub's cap in dollars, asked only for a >10x move. */
export function judge(stored: Stored, sourceCap: number, second?: number | null): { ok: true; note?: string } | { ok: false; reason: string } {
  if (!Number.isFinite(sourceCap) || sourceCap <= 0) return { ok: false, reason: "zero or negative" };
  if (sourceCap > MAX_PLAUSIBLE_CAP) return { ok: false, reason: "above $10T" };
  if (plausible(stored.marketCap)) {
    const r = sourceCap / stored.marketCap;
    if (r > MAX_RATIO || r < 1 / MAX_RATIO) {
      if (typeof second === "number" && second > 0 && Math.abs(second / sourceCap - 1) <= SECOND_OPINION_TOLERANCE) {
        return { ok: true, note: `moved ${r.toFixed(1)}x vs stored; Finnhub agrees` };
      }
      return { ok: false, reason: `changed ${r >= 1 ? r.toFixed(1) : (1 / r).toFixed(1)}x ${r >= 1 ? "up" : "down"} vs stored, not confirmed by Finnhub` };
    }
  }
  return { ok: true };
}

export function needsSecondOpinion(stored: Stored, sourceCap: number): boolean {
  if (!plausible(stored.marketCap) || !(sourceCap > 0) || sourceCap > MAX_PLAUSIBLE_CAP) return false;
  const r = sourceCap / stored.marketCap;
  return r > MAX_RATIO || r < 1 / MAX_RATIO;
}

export interface Plan {
  tickers: number;
  fetched: number;
  accepted: Accepted[];
  rejected: Rejected[];
  noData: string[];
  failedBatches: number;
  counts: { bucketChanged: number; nullToBucket: number; sameBucket: number; byBucket: Record<CapSize, number>; keptOldBucketNoData: number };
}

export function plan(stored: Stored[], fetched: Map<string, number>, second: Map<string, number | null>, failedBatches = 0, preRejected: Rejected[] = []): Plan {
  const accepted: Accepted[] = [], rejected: Rejected[] = [...preRejected], noData: string[] = [];
  const pre = new Set(preRejected.map((r) => r.symbol));
  for (const s of stored) {
    if (pre.has(s.symbol)) continue;
    const cap = fetched.get(s.symbol);
    if (cap === undefined) { noData.push(s.symbol); continue; }
    const j = judge(s, cap, second.get(s.symbol));
    if (!j.ok) { rejected.push({ symbol: s.symbol, storedCap: s.marketCap, sourceCap: cap, reason: j.reason }); continue; }
    accepted.push({ symbol: s.symbol, oldCap: s.marketCap, newCap: cap, oldBucket: s.bucket, newBucket: bucketOf(cap), source: "fmp", ...(j.note ? { note: j.note } : {}) });
  }
  const byBucket = { MEGA: 0, LARGE: 0, MID: 0, SMALL: 0, MICRO: 0 } as Record<CapSize, number>;
  for (const a of accepted) byBucket[a.newBucket]++;
  return {
    tickers: stored.length, fetched: fetched.size, accepted, rejected, noData, failedBatches,
    counts: {
      bucketChanged: accepted.filter((a) => a.oldBucket !== null && a.oldBucket !== a.newBucket).length,
      nullToBucket: accepted.filter((a) => a.oldBucket === null).length,
      sameBucket: accepted.filter((a) => a.oldBucket === a.newBucket).length,
      byBucket,
      keptOldBucketNoData: noData.filter((sym) => stored.find((s) => s.symbol === sym)?.bucket).length,
    },
  };
}

type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

export interface Sources {
  /** FMP caps for up to 100 symbols; throws on a failed call (that batch is counted, its symbols get no data). */
  /** cap in dollars and FMP's date for that cap, keyed by MarketFlow's symbol (BRK.B, not BRK-B). */
  fmpBatch(symbols: string[]): Promise<Map<string, { cap: number; date: string | null }>>;
  finnhub(symbol: string): Promise<number | null>;
  sleep(ms: number): Promise<void>;
}

export const toFmpSymbol = (s: string) => s.toUpperCase().replace(/\./g, "-");
/** A cap whose own date is older than this is not today's cap (the ticker may have stopped trading). */
export const MAX_CAP_AGE_DAYS = 10;
export function isStale(capDate: string | null, asOf: string): boolean {
  if (!capDate) return false;
  return (Date.parse(asOf + "T00:00:00Z") - Date.parse(capDate + "T00:00:00Z")) / 864e5 > MAX_CAP_AGE_DAYS;
}

export function liveSources(env: NodeJS.ProcessEnv = process.env): Sources {
  return {
    async fmpBatch(symbols) {
      const key = env.FMP_API_KEY;
      if (!key) throw new Error("FMP_API_KEY is not set");
      // FMP writes share classes with a dash (BRK-B); MarketFlow keeps the dot (BRK.B)
      const back = new Map(symbols.map((s) => [toFmpSymbol(s), s]));
      const r = await fetch(`https://financialmodelingprep.com/stable/market-capitalization-batch?symbols=${encodeURIComponent([...back.keys()].join(","))}&apikey=${key}`, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`FMP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error("FMP: unexpected response");
      const out = new Map<string, { cap: number; date: string | null }>();
      for (const row of data) {
        if (!row?.symbol || typeof row.marketCap !== "number") continue;
        const fmp = String(row.symbol).toUpperCase();
        out.set(back.get(fmp) ?? fmp, { cap: row.marketCap, date: typeof row.date === "string" ? row.date.slice(0, 10) : null });
      }
      return out;
    },
    async finnhub(symbol) {
      const key = env.FINNHUB_API_KEY;
      if (!key) return null;
      const r = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!r?.ok) return null;
      const m = (await r.json())?.metric?.marketCapitalization;
      return typeof m === "number" && m > 0 ? m * 1e6 : null; // Finnhub gives millions
    },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  };
}

export async function refreshMarketCaps(db: Exec, opts: { dryRun: boolean; sources?: Sources; asOf?: string; log?: (s: string) => void }) {
  const src = opts.sources ?? liveSources();
  const log = opts.log ?? ((s: string) => console.log(s));
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const stored: Stored[] = rowsOf(await db.execute(sql`SELECT symbol, market_cap, market_cap_size FROM tickers ORDER BY symbol`)).map((x) => ({
    symbol: String(x.symbol).toUpperCase(), marketCap: x.market_cap === null || x.market_cap === undefined ? null : Number(x.market_cap), bucket: normalizeCapSize(x.market_cap_size),
  }));
  const fetched = new Map<string, number>();
  const stale: Rejected[] = [];
  let failed = 0;
  for (let i = 0; i < stored.length; i += 100) {
    if (i) await src.sleep(1000);
    try {
      for (const [s, c] of await src.fmpBatch(stored.slice(i, i + 100).map((x) => x.symbol))) {
        if (isStale(c.date, asOf)) stale.push({ symbol: s, storedCap: stored.find((x) => x.symbol === s)?.marketCap ?? null, sourceCap: c.cap, reason: `stale: FMP's latest cap is dated ${c.date}` });
        else fetched.set(s, c.cap);
      }
    } catch (err) {
      failed++;
      log(`[MarketCaps] batch ${i / 100 + 1} failed: ${String(err).slice(0, 120)}`);
    }
  }
  const second = new Map<string, number | null>();
  for (const s of stored) {
    const c = fetched.get(s.symbol);
    if (c !== undefined && needsSecondOpinion(s, c)) { second.set(s.symbol, await src.finnhub(s.symbol)); await src.sleep(1100); }
  }
  const p = plan(stored, fetched, second, failed, stale);
  log(`[MarketCaps] ${opts.dryRun ? "DRY RUN" : "RUN"} ${asOf}: ${p.tickers} tickers, ${p.fetched} caps fetched (${p.failedBatches} failed batches)`);
  log(`[MarketCaps] would write ${p.accepted.length}: ${p.counts.bucketChanged} change bucket, ${p.counts.nullToBucket} go from no bucket to a bucket, ${p.counts.sameBucket} keep their bucket; by bucket ${JSON.stringify(p.counts.byBucket)}`);
  log(`[MarketCaps] not written: ${p.rejected.length} implausible, ${p.noData.length} with no data from FMP (${p.counts.keptOldBucketNoData} of those keep an old bucket)`);
  for (const r of p.rejected) log(`[MarketCaps]   rejected ${r.symbol}: ${r.reason} (stored ${r.storedCap ?? "none"}, source ${r.sourceCap})`);
  if (opts.dryRun) return { dryRun: true, asOf, ...summary(p) };
  if (p.failedBatches) {
    log(`[MarketCaps] not writing: ${p.failedBatches} FMP batch(es) failed; rerun when the source answers`);
    return { dryRun: false, asOf, written: 0, aborted: "FMP batch failed", ...summary(p) };
  }
  for (const s of DDL) await db.execute(sql.raw(s));
  let written = 0;
  for (const a of p.accepted) {
    await db.execute(sql`INSERT INTO market_cap_history (as_of, symbol, market_cap, bucket, source, boundaries) VALUES (${asOf}::date, ${a.symbol}, ${a.newCap}, ${a.newBucket}, ${a.source}, ${JSON.stringify(BOUNDARIES)}::jsonb) ON CONFLICT (as_of, symbol, source) DO NOTHING`);
    await db.execute(sql`UPDATE tickers SET market_cap = ${a.newCap}, market_cap_size = ${a.newBucket} WHERE symbol = ${a.symbol}`);
    written++;
  }
  resetCapSizeCacheForTests(); // capSize reads the new buckets at once
  log(`[MarketCaps] written ${written}`);
  return { dryRun: false, asOf, written, ...summary(p) };
}

function summary(p: Plan) {
  return {
    tickers: p.tickers, fetched: p.fetched, failedBatches: p.failedBatches, accepted: p.accepted.length, counts: p.counts,
    rejected: p.rejected, noData: p.noData.length, noDataSymbols: p.noData.slice(0, 200),
    bucketChanges: p.accepted.filter((a) => a.oldBucket !== a.newBucket).map((a) => `${a.symbol} ${a.oldBucket ?? "none"}->${a.newBucket}`).slice(0, 400),
  };
}
