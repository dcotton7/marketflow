/**
 * R7, the screen route: the pure part (query parsing, rows, filters, sort). screen.ts feeds it from the live
 * snapshot and the daily summary; nothing here reads a database, the vendor or the engine, so it is all testable.
 *
 * Contract: GET /api/market-condition/screen (owner; Anima gateway allow-listed). Every filter is optional.
 *   symbols=NVDA,AAPL   exactly these tickers (up to 100): a row each, wherever they rank. Filters still apply; a
 *                       requested name that is not in the universe is listed in `missing`, one the filters
 *                       dropped is listed in `unmatched`, so nothing disappears silently
 *   themes=a,b          theme ids (live and end-of-day theme names; pool-only names have none)
 *   universe=all|themes|pool   default all: theme names plus the scan pool
 *   side=long|short     long: changePct >= 0; short: changePct <= 0
 *   pctMin, pctMax      today's change %
 *   above, below        comma list of vwap, ema10, ema20, sma20, sma50, sma200 (price above / below each)
 *   nearMa + nearPct    within nearPct % of that line (either side)
 *   nearHigh, nearLow   within x% of, or beyond, the prior day's high (a breakout) / low (a breakdown)
 *   minDollarVol, minPrice, minVolExp, trend=Bull|Transition|Bear
 *   sort=<field>        descending by default, `dir=asc` flips it; rsRank is the exception: 1 is best, so
 *                       sort=rsRank lists best first (ascending) unless dir=desc. Empty values go last either way.
 *                       Fields: SORT_FIELDS. Default sort: dollarVol.
 *   limit               default 50, at most 100
 * Every row says what it is: source "live" (priceAsOf = the snapshot time) or "eod" (priceAsOf = the session date,
 * the price is that session's close and VWAP is null). A day-old price is never labelled live.
 */
import type { DailySummary } from "./daily-summary";

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 50;
export const LINES = ["vwap", "ema10", "ema20", "sma20", "sma50", "sma200"] as const;
export type Line = (typeof LINES)[number];
export const SORT_FIELDS = [
  "changePct", "vwapPct", "pctVsEma10d", "pctVsEma20d", "pctVsSma20d", "pctVsSma50d", "pctVsSma200d", "price",
  "dollarVol", "volExp", "rsRank", "marketCap", "dayHigh", "dayLow", "baseHigh", "prevDayHigh", "prevDayLow",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type Trend = "Bull" | "Transition" | "Bear";

export interface LiveSym {
  symbol: string;
  themeIds: string[];
  price: number;
  prevClose: number;
  changePct: number;
  vwap: number | null;
  dayHigh: number;
  dayLow: number;
  volume: number;
  prevDayHigh: number | null;
  prevDayLow: number | null;
  avgVolume20D: number | null;
  pctVsEma10d: number | null;
  pctVsEma20d: number | null;
  pctVsSma20d: number | null;
  pctVsSma50d: number | null;
  pctVsSma200d: number | null;
  trendState: Trend;
  rsRank: number | null;
  isLeader: boolean;
  snapshotAt: string; // ISO
  /** ET date of the snapshot, to pick the right base_high */
  etDate: string;
}

export interface ScreenRow {
  symbol: string;
  themeId: string | null;
  themeIds: string[];
  source: "live" | "eod";
  priceAsOf: string;
  price: number;
  changePct: number | null;
  vwapPct: number | null;
  pctVsEma10d: number | null;
  pctVsEma20d: number | null;
  pctVsSma20d: number | null;
  pctVsSma50d: number | null;
  pctVsSma200d: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevDayHigh: number | null;
  prevDayLow: number | null;
  baseHigh: number | null;
  dollarVol: number | null;
  volExp: number | null;
  trendState: Trend | null;
  rsRank: number | null;
  isLeader: boolean | null;
  sector: string | null;
  industry: string | null;
  capSize: string | null;
  marketCap: number | null;
}

export interface ScreenQuery {
  symbols: string[] | null;
  themes: string[] | null;
  universe: "all" | "themes" | "pool";
  side: "long" | "short" | null;
  pctMin: number | null;
  pctMax: number | null;
  above: Line[];
  below: Line[];
  nearMa: Line | null;
  nearPct: number | null;
  nearHigh: number | null;
  nearLow: number | null;
  minDollarVol: number | null;
  minPrice: number | null;
  minVolExp: number | null;
  trend: Trend | null;
  sort: SortField;
  dir: "asc" | "desc";
  limit: number;
}

type Raw = Record<string, unknown>;
const first = (v: unknown): string | undefined => (Array.isArray(v) ? (v[0] === undefined ? undefined : String(v[0])) : v === undefined || v === null ? undefined : String(v));
const list = (v: unknown): string[] => (first(v) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function parseScreenQuery(q: Raw): { ok: true; query: ScreenQuery } | { ok: false; error: string } {
  const numField = (name: string): number | null | "bad" => {
    const v = first(q[name]);
    if (v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : "bad";
  };
  const nums: Record<string, number | null> = {};
  for (const k of ["pctMin", "pctMax", "nearPct", "nearHigh", "nearLow", "minDollarVol", "minPrice", "minVolExp"]) {
    const n = numField(k);
    if (n === "bad") return { ok: false, error: `${k} must be a number` };
    nums[k] = n;
  }
  const lines = (name: string): Line[] | string => {
    const out: Line[] = [];
    for (const l of list(q[name])) {
      if (!(LINES as readonly string[]).includes(l)) return `${name}: "${l}" is not one of ${LINES.join(", ")}`;
      out.push(l as Line);
    }
    return out;
  };
  const above = lines("above");
  if (typeof above === "string") return { ok: false, error: above };
  const below = lines("below");
  if (typeof below === "string") return { ok: false, error: below };
  const nearMaRaw = first(q.nearMa);
  if (nearMaRaw && !(LINES as readonly string[]).includes(nearMaRaw)) return { ok: false, error: `nearMa must be one of ${LINES.join(", ")}` };
  if (nearMaRaw && nums.nearPct === null) return { ok: false, error: "nearMa needs nearPct" };
  const side = first(q.side);
  if (side && side !== "long" && side !== "short") return { ok: false, error: "side must be long or short" };
  const trend = first(q.trend);
  if (trend && !["Bull", "Transition", "Bear"].includes(trend)) return { ok: false, error: "trend must be Bull, Transition or Bear" };
  const universe = first(q.universe) ?? "all";
  if (!["all", "themes", "pool"].includes(universe)) return { ok: false, error: "universe must be all, themes or pool" };
  const sort = first(q.sort) ?? "dollarVol";
  if (!(SORT_FIELDS as readonly string[]).includes(sort)) return { ok: false, error: `sort must be one of ${SORT_FIELDS.join(", ")}` };
  const dirRaw = first(q.dir);
  if (dirRaw && dirRaw !== "asc" && dirRaw !== "desc") return { ok: false, error: "dir must be asc or desc" };
  const dir = dirRaw ?? (sort === "rsRank" ? "asc" : "desc");
  const limitRaw = first(q.limit);
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "limit must be a whole number of 1 or more" };
    limit = Math.min(n, MAX_LIMIT);
  }
  const symbols = list(q.symbols).map((s) => s.toUpperCase().replace("-", "."));
  if (symbols.some((s) => !/^[A-Z0-9.^]{1,12}$/.test(s))) return { ok: false, error: "symbols must be tickers, comma separated" };
  if (symbols.length > MAX_LIMIT) return { ok: false, error: `symbols takes at most ${MAX_LIMIT} tickers` };
  const themes = list(q.themes);
  return {
    ok: true,
    query: {
      symbols: symbols.length ? [...new Set(symbols)] : null,
      themes: themes.length ? themes : null,
      universe: universe as ScreenQuery["universe"],
      side: (side as ScreenQuery["side"]) ?? null,
      pctMin: nums.pctMin ?? null,
      pctMax: nums.pctMax ?? null,
      above,
      below,
      nearMa: (nearMaRaw as Line) ?? null,
      nearPct: nums.nearPct ?? null,
      nearHigh: nums.nearHigh ?? null,
      nearLow: nums.nearLow ?? null,
      minDollarVol: nums.minDollarVol ?? null,
      minPrice: nums.minPrice ?? null,
      minVolExp: nums.minVolExp ?? null,
      trend: (trend as Trend) ?? null,
      sort: sort as SortField,
      dir: dir as "asc" | "desc",
      limit,
    },
  };
}

const pct = (price: number, line: number | null): number | null => (line && line > 0 ? ((price - line) / line) * 100 : null);
const round = (n: number | null, d = 4): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

function trendOf(price: number, s: DailySummary): Trend | null {
  if (s.sma50 === null || s.sma200 === null) return null;
  const a50 = price > s.sma50;
  const a200 = price > s.sma200;
  return a50 && a200 ? "Bull" : !a50 && !a200 ? "Bear" : "Transition";
}

/** The row for a theme name that has a live snapshot, joined to its summary for base_high, size and profile. */
export function liveRow(l: LiveSym, s: DailySummary | undefined): ScreenRow {
  const avg = l.avgVolume20D ?? s?.avgVolume20 ?? null;
  const dollarVol = s?.avgDollarVol20 != null && l.avgVolume20D == null ? s.avgDollarVol20 : avg !== null ? l.price * avg : null;
  // the base high BEFORE this row's own day: if the summary's newest session is already today, leave it out
  const base = s ? (s.asOf >= l.etDate ? s.baseHighPrior : s.baseHighIncl) : null;
  return {
    symbol: l.symbol,
    themeId: l.themeIds[0] ?? null,
    themeIds: l.themeIds,
    source: "live",
    priceAsOf: l.snapshotAt,
    price: l.price,
    changePct: round(l.changePct),
    vwapPct: l.vwap ? round(pct(l.price, l.vwap)) : null,
    pctVsEma10d: round(l.pctVsEma10d),
    pctVsEma20d: round(l.pctVsEma20d),
    pctVsSma20d: round(l.pctVsSma20d),
    pctVsSma50d: round(l.pctVsSma50d),
    pctVsSma200d: round(l.pctVsSma200d),
    dayHigh: l.dayHigh,
    dayLow: l.dayLow,
    prevDayHigh: l.prevDayHigh ?? (s ? (s.asOf >= l.etDate ? s.prevHigh : s.high) : null),
    prevDayLow: l.prevDayLow ?? (s ? (s.asOf >= l.etDate ? s.prevLow : s.low) : null),
    baseHigh: base,
    dollarVol: round(dollarVol, 0),
    volExp: avg && avg > 0 ? round(l.volume / avg, 2) : null,
    trendState: l.trendState,
    rsRank: l.rsRank,
    isLeader: l.isLeader,
    sector: s?.sector ?? null,
    industry: s?.industry ?? null,
    capSize: s?.capSize ?? null,
    marketCap: s?.marketCap ?? null,
  };
}

/** The row from the end-of-day summary alone: pool names, and theme names with no live snapshot. */
export function eodRow(s: DailySummary, themeIds: string[]): ScreenRow {
  return {
    symbol: s.symbol,
    themeId: themeIds[0] ?? null,
    themeIds,
    source: "eod",
    priceAsOf: s.asOf,
    price: s.close,
    changePct: s.prevClose ? round(pct(s.close, s.prevClose)) : null,
    vwapPct: null,
    pctVsEma10d: round(pct(s.close, s.ema10)),
    pctVsEma20d: round(pct(s.close, s.ema20)),
    pctVsSma20d: round(pct(s.close, s.sma20)),
    pctVsSma50d: round(pct(s.close, s.sma50)),
    pctVsSma200d: round(pct(s.close, s.sma200)),
    dayHigh: s.high,
    dayLow: s.low,
    prevDayHigh: s.prevHigh,
    prevDayLow: s.prevLow,
    baseHigh: s.baseHighPrior,
    dollarVol: round(s.avgDollarVol20, 0),
    volExp: round(s.volExp, 2),
    trendState: trendOf(s.close, s),
    rsRank: null,
    isLeader: null,
    sector: s.sector,
    industry: s.industry,
    capSize: s.capSize,
    marketCap: s.marketCap,
  };
}

export const STALE_DAYS = 7;

/** Summaries more than STALE_DAYS calendar days behind the newest one (names whose bars stopped) are not served as prices. */
export function dropStale(summaries: Map<string, DailySummary>): { kept: Map<string, DailySummary>; dropped: number } {
  let newest = "";
  for (const s of summaries.values()) if (s.asOf > newest) newest = s.asOf;
  if (!newest) return { kept: summaries, dropped: 0 };
  const cutoff = new Date(Date.parse(newest + "T00:00:00Z") - STALE_DAYS * 864e5).toISOString().slice(0, 10);
  const kept = new Map<string, DailySummary>();
  for (const [k, s] of summaries) if (s.asOf >= cutoff) kept.set(k, s);
  return { kept, dropped: summaries.size - kept.size };
}

/** Live rows win; every other summarized symbol becomes an end-of-day row. */
export function buildRows(live: LiveSym[], summaries: Map<string, DailySummary>, themesOf: (symbol: string) => string[]): ScreenRow[] {
  const rows: ScreenRow[] = [];
  const seen = new Set<string>();
  for (const l of live) {
    rows.push(liveRow(l, summaries.get(l.symbol.toUpperCase())));
    seen.add(l.symbol.toUpperCase());
  }
  for (const [sym, s] of summaries) {
    if (seen.has(sym)) continue;
    rows.push(eodRow(s, themesOf(sym)));
  }
  return rows;
}

function lineValue(r: ScreenRow, l: Line): number | null {
  switch (l) {
    case "vwap": return r.vwapPct;
    case "ema10": return r.pctVsEma10d;
    case "ema20": return r.pctVsEma20d;
    case "sma20": return r.pctVsSma20d;
    case "sma50": return r.pctVsSma50d;
    case "sma200": return r.pctVsSma200d;
  }
}

export function passes(r: ScreenRow, q: ScreenQuery): boolean {
  if (q.themes && !r.themeIds.some((t) => q.themes!.includes(t))) return false;
  if (q.universe === "themes" && r.themeIds.length === 0) return false;
  if (q.universe === "pool" && r.themeIds.length > 0) return false;
  if (q.side === "long" && !(r.changePct !== null && r.changePct >= 0)) return false;
  if (q.side === "short" && !(r.changePct !== null && r.changePct <= 0)) return false;
  if (q.pctMin !== null && !(r.changePct !== null && r.changePct >= q.pctMin)) return false;
  if (q.pctMax !== null && !(r.changePct !== null && r.changePct <= q.pctMax)) return false;
  for (const l of q.above) { const v = lineValue(r, l); if (v === null || !(v > 0)) return false; }
  for (const l of q.below) { const v = lineValue(r, l); if (v === null || !(v < 0)) return false; }
  if (q.nearMa && q.nearPct !== null) { const v = lineValue(r, q.nearMa); if (v === null || Math.abs(v) > q.nearPct) return false; }
  if (q.nearHigh !== null && !(r.prevDayHigh !== null && r.price >= r.prevDayHigh * (1 - q.nearHigh / 100))) return false;
  if (q.nearLow !== null && !(r.prevDayLow !== null && r.price <= r.prevDayLow * (1 + q.nearLow / 100))) return false;
  if (q.minDollarVol !== null && !(r.dollarVol !== null && r.dollarVol >= q.minDollarVol)) return false;
  if (q.minPrice !== null && !(r.price >= q.minPrice)) return false;
  if (q.minVolExp !== null && !(r.volExp !== null && r.volExp >= q.minVolExp)) return false;
  if (q.trend && r.trendState !== q.trend) return false;
  return true;
}

export function sortRows(rows: ScreenRow[], q: ScreenQuery): ScreenRow[] {
  const sign = q.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[q.sort] as number | null;
    const y = b[q.sort] as number | null;
    if (x === null && y === null) return a.symbol < b.symbol ? -1 : 1;
    if (x === null) return 1; // empty values last either way
    if (y === null) return -1;
    return x === y ? (a.symbol < b.symbol ? -1 : 1) : (x - y) * sign;
  });
}

export interface ScreenAnswer {
  universe: number;
  matched: number;
  returned: number;
  rows: ScreenRow[];
  missing: string[];
  unmatched: string[];
  truncated: boolean;
}

export function runScreen(all: ScreenRow[], q: ScreenQuery): ScreenAnswer {
  const bySym = new Map(all.map((r) => [r.symbol.toUpperCase(), r]));
  let pool = all;
  const missing: string[] = [];
  const unmatched: string[] = [];
  if (q.symbols) {
    pool = [];
    for (const s of q.symbols) {
      const r = bySym.get(s);
      if (r) pool.push(r);
      else missing.push(s);
    }
  }
  const matchedRows = pool.filter((r) => passes(r, q));
  if (q.symbols) {
    const got = new Set(matchedRows.map((r) => r.symbol.toUpperCase()));
    for (const r of pool) if (!got.has(r.symbol.toUpperCase())) unmatched.push(r.symbol);
  }
  const sorted = sortRows(matchedRows, q);
  const rows = sorted.slice(0, q.limit);
  return { universe: all.length, matched: matchedRows.length, returned: rows.length, rows, missing, unmatched, truncated: sorted.length > rows.length };
}
