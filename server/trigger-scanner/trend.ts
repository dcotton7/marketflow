/**
 * Trend facts on each candidate (Don, 27 Nov: "setups above 50d, 200d, with no clear immediate resistance are best
 * for longs. If not above, like to see flatening or rising 50d, 200d ... Tight MA's and basing is also desireable.
 * But lets have her continue to test these various setups"; and "In a recovery market though, we need to see which
 * stocks are recovering first ... getting back to it, base and go is ideal of course").
 *
 * FACTS TO MEASURE, NEVER A FILTER: nothing here changes a grade, a pass rule, the stop or any other field; a
 * candidate is raised exactly as before and carries `trend` beside it. A name with too little history gets nulls
 * and a reason in `missing`, never a guess. Every threshold is a setting (settings.ts, `trend*`, plus the gap rule's
 * own `baseRangeAdr` / `baseMinDays` for the base). Definitions (docs/trigger-scanner.md, "Trend facts"):
 *
 *   averages   simple averages of daily closes through the last finished session (the scanner's own SMA).
 *   vs price   the trigger bar's close (entry_ref) against each average: above/below and % distance.
 *   slope      (average now / average k sessions ago - 1) x 100; k = 10 for the 20 and 50-day, 20 for the 200-day.
 *              rising / flat / falling, flat = within +-1% (20-day), +-0.5% (50 and 200-day).
 *   tight      max minus min of the 10, 20 and 50-day SMAs, over price, x 100; tight when <= 3%.
 *   base       a PROXY: gap.ts's preGapBase (the longest run of finished sessions ending yesterday whose high-low
 *              range stays within baseRangeAdr [3] ADR), a base when it lasts at least baseMinDays [15] sessions.
 *   room       at the trigger, the nearest DAILY level in the trade's direction (above a long's entry, below a
 *              short's) among the scanner's daily levels, the 200-day SMA and the 20-session high (a short: low);
 *              session levels (VWAP, opening range, high/low of day) are not counted. Distance in ADR and %;
 *              clear = none within trendRoomAdr [1] ADR (no level at all in the direction = clear, level null).
 *   reclaim    per average: % distance of the last close now and trendReclaimCloseN [5] sessions ago; "closing" when
 *              below now and nearer than then; the newest close back above it after at least trendReclaimMinBelow
 *              [5] closes below, within trendReclaimLookback [40] sessions, its date and sessions ago (yesterday =
 *              1); "recent" within trendReclaimRecent [10] sessions. A short mirrors it (a close back below).
 *   vs SPY     the move off the lowest close of the last trendOffLowSessions [40] sessions, for the name and SPY,
 *              and the difference; whether the name reclaimed its 50-day before SPY did (null when neither has).
 *   base & go  any setup: a base present and the trigger bar closing above the base's high while yesterday's close
 *              was at or under it (a short: below the low, from at or over it). Gap and go: the gap rule's own
 *              pre-gap base (`from_base`), so there is one base definition, not two.
 *   market     SPY against its own 50-day: below, or reclaimed within trendReclaimRecent sessions (context only).
 *   short      the mirror image of the long (below the 200 and 50-day, averages flat or falling, no support within
 *              1 ADR below): the COORDINATOR'S ASSUMPTION until Don confirms; the facts themselves are side-neutral.
 */
import { preGapBase } from "./gap";
import type { ScannerSettings } from "./settings";
import type { DailyBar, Level, Side } from "./types";

export const TREND_VERSION = 1;
/** Sessions the daily load must read for every trend fact: the 200-day, 40 sessions of its history (the reclaim
 *  look-back) and 5 closes below before the oldest reclaim, with a margin. Also covers the 20-session slope (220). */
export const TREND_SESSIONS = 250;

type Slope = "rising" | "flat" | "falling";
export interface AvgDaily {
  value: number | null;
  slopePct: number | null;
  slope: Slope | null;
  slopeSessions: number;
  /** % distance of the last close from the average now and trendReclaimCloseN sessions ago. */
  distNowPct: number | null;
  distThenPct: number | null;
  /** The newest cross back over the average after at least trendReclaimMinBelow closes on the other side. */
  reclaimUp: { date: string; sessionsAgo: number } | null;
  reclaimDown: { date: string; sessionsAgo: number } | null;
}

/** The daily part, computed once a day per name (day-data.ts). */
export interface TrendDaily {
  asOf: string;
  sessions: number;
  lastClose: number;
  sma10: number | null;
  avg: { sma20: AvgDaily; sma50: AvgDaily; sma200: AvgDaily };
  base: { days: number; top: number; bottom: number; rangePct: number; rangeAdr: number | null; ok: boolean };
  high20: number;
  low20: number;
  offLowPct: number | null;
  missing: string[];
}

const r = (x: number | null, d = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

function smaSeriesOf(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let s = 0;
  for (let i = 0; i < closes.length; i++) {
    s += closes[i];
    if (i >= n) s -= closes[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** Index of the newest close past the average (up: above) after >= minPrior closes on the other side, within lookback. */
function lastCross(closes: number[], sma: (number | null)[], up: boolean, minPrior: number, lookback: number): number | null {
  const n = closes.length;
  const past = (i: number) => sma[i] !== null && (up ? closes[i] > sma[i]! : closes[i] < sma[i]!);
  const before = (i: number) => sma[i] !== null && (up ? closes[i] < sma[i]! : closes[i] > sma[i]!);
  for (let j = n - 1; j >= Math.max(minPrior, n - lookback); j--) {
    if (!past(j)) continue;
    let ok = true;
    for (let k = j - minPrior; k < j; k++) if (!before(k)) { ok = false; break; }
    if (ok) return j;
  }
  return null;
}

function avgDaily(b: DailyBar[], closes: number[], n: number, k: number, flatPct: number, st: ScannerSettings, missing: string[]): AvgDaily {
  const series = smaSeriesOf(closes, n);
  const last = closes.length - 1;
  const value = series[last];
  const then = last - k >= 0 ? series[last - k] : null;
  const name = `sma${n}`;
  if (value === null) missing.push(`${name}: ${closes.length} sessions, needs ${n}`);
  else if (then === null) missing.push(`${name} slope: ${closes.length} sessions, needs ${n + k}`);
  const slopePct = value !== null && then !== null ? (value / then - 1) * 100 : null;
  const slope: Slope | null = slopePct === null ? null : slopePct > flatPct ? "rising" : slopePct < -flatPct ? "falling" : "flat";
  const N = st.trendReclaimCloseN;
  const dist = (i: number) => (i >= 0 && series[i] !== null ? (closes[i] / series[i]! - 1) * 100 : null);
  const cross = (up: boolean) => {
    const j = lastCross(closes, series, up, st.trendReclaimMinBelow, st.trendReclaimLookback);
    return j === null ? null : { date: b[j].date, sessionsAgo: last - j + 1 };
  };
  return { value, slopePct, slope, slopeSessions: k, distNowPct: dist(last), distThenPct: dist(last - N), reclaimUp: cross(true), reclaimDown: cross(false) };
}

/** Finished daily bars (oldest first, today not included), the ADR in dollars. */
export function dailyTrend(b: DailyBar[], adr: number, st: ScannerSettings): TrendDaily {
  const closes = b.map((x) => x.close);
  const missing: string[] = [];
  const last = b[b.length - 1];
  const sma10 = smaSeriesOf(closes, 10)[closes.length - 1];
  const base = preGapBase(b, b.length - 1, adr, st.baseRangeAdr, Math.max(60, st.baseMinDays));
  const w20 = b.slice(-20);
  const wl = closes.slice(-st.trendOffLowSessions);
  const low = Math.min(...wl);
  if (closes.length < st.trendOffLowSessions) missing.push(`off the low: ${closes.length} sessions, needs ${st.trendOffLowSessions}`);
  return {
    asOf: last.date,
    sessions: b.length,
    lastClose: last.close,
    sma10,
    avg: {
      sma20: avgDaily(b, closes, 20, st.trendSlope20Sessions, st.trendFlat20Pct, st, missing),
      sma50: avgDaily(b, closes, 50, st.trendSlope50Sessions, st.trendFlat50Pct, st, missing),
      sma200: avgDaily(b, closes, 200, st.trendSlope200Sessions, st.trendFlat200Pct, st, missing),
    },
    base: {
      days: base.days, top: base.top, bottom: base.bottom,
      rangePct: ((base.top - base.bottom) / last.close) * 100,
      rangeAdr: adr > 0 ? (base.top - base.bottom) / adr : null,
      ok: adr > 0 && base.days >= st.baseMinDays,
    },
    high20: Math.max(...w20.map((x) => x.high)),
    low20: Math.min(...w20.map((x) => x.low)),
    offLowPct: closes.length >= st.trendOffLowSessions && low > 0 ? (last.close / low - 1) * 100 : null,
    missing,
  };
}

/** The served shape (snake_case, as the route's other fields). */
export interface CandidateTrend {
  v: number;
  known: boolean;
  as_of: string | null;
  sessions: number | null;
  price: number;
  side: Side;
  ma: Record<"sma20" | "sma50" | "sma200", {
    value: number | null; above: boolean | null; pct: number | null;
    slope: Slope | null; slope_pct: number | null; slope_sessions: number;
  }>;
  above_50_and_200: boolean | null;
  below_50_and_200: boolean | null;
  tight: { ok: boolean | null; spread_pct: number | null; max_pct: number };
  base: { ok: boolean | null; days: number | null; high: number | null; low: number | null; range_pct: number | null; range_adr: number | null; min_days: number; max_range_adr: number; measure: string };
  room: { level: string | null; price: number | null; dist_adr: number | null; dist_pct: number | null; clear: boolean | null; within_adr: number };
  reclaim: Record<"sma20" | "sma50" | "sma200", {
    dist_now_pct: number | null; dist_then_pct: number | null; then_sessions: number;
    closing: boolean | null; date: string | null; sessions_ago: number | null; recent: boolean | null;
  }>;
  vs_spy: { off_low_pct: number | null; spy_off_low_pct: number | null; vs_spy_off_low_pct: number | null; sessions: number; reclaimed_50_before_spy: boolean | null; spy_reclaim_50_date: string | null };
  base_and_go: { ok: boolean | null; how: string | null };
  market: { spy_above_50: boolean | null; spy_pct_vs_50: number | null; spy_reclaim_50_sessions_ago: number | null; spy_reclaimed_50_recent: boolean | null };
  missing: string[];
}

export interface TrendInput {
  daily: TrendDaily | null | undefined;
  spy: TrendDaily | null | undefined;
  side: Side;
  entry: number;
  adr: number;
  /** The scanner's DAILY levels at the trigger (levels.ts dailyLevels). */
  dailyLevels: Level[];
  /** The previous session's close (base and go: crossed today). */
  prevClose: number;
  setupKey: string;
  facts: Record<string, number | string | null>;
}

const NAMES = ["sma20", "sma50", "sma200"] as const;

export function candidateTrend(t: TrendInput, st: ScannerSettings): CandidateTrend {
  const d = t.daily ?? null;
  const long = t.side === "long";
  const missing = d ? [...d.missing] : ["no daily trend for this name"];
  const ma = {} as CandidateTrend["ma"];
  const reclaim = {} as CandidateTrend["reclaim"];
  for (const k of NAMES) {
    const a = d?.avg[k];
    const v = a?.value ?? null;
    ma[k] = { value: r(v, 4), above: v === null ? null : t.entry > v, pct: v === null ? null : r((t.entry / v - 1) * 100), slope: a?.slope ?? null, slope_pct: r(a?.slopePct ?? null, 3), slope_sessions: a?.slopeSessions ?? 0 };
    // reclaim: a long getting back above; a short (the mirror) getting back below
    const now = a?.distNowPct ?? null, then = a?.distThenPct ?? null;
    const away = now === null ? null : long ? now < 0 : now > 0;
    const cross = a ? (long ? a.reclaimUp : a.reclaimDown) : null;
    reclaim[k] = {
      dist_now_pct: r(now), dist_then_pct: r(then), then_sessions: st.trendReclaimCloseN,
      closing: away === null || then === null ? null : away && Math.abs(now!) < Math.abs(then),
      date: cross?.date ?? null, sessions_ago: cross?.sessionsAgo ?? null,
      recent: a ? (cross ? cross.sessionsAgo <= st.trendReclaimRecent : false) : null,
    };
  }
  const both = (want: boolean) => (ma.sma50.above === null || ma.sma200.above === null ? null : ma.sma50.above === want && ma.sma200.above === want);
  // tight: the 10, 20 and 50-day within trendTightPct of each other, over price
  const avgs = [d?.sma10 ?? null, d?.avg.sma20.value ?? null, d?.avg.sma50.value ?? null];
  const spread = avgs.every((x) => x !== null) ? ((Math.max(...(avgs as number[])) - Math.min(...(avgs as number[]))) / t.entry) * 100 : null;
  // room: the nearest daily level in the trade's direction
  const pool: { name: string; price: number }[] = t.dailyLevels
    .filter((l) => (long ? l.price > t.entry && (!l.gap || l.gap.role === "resistance") : l.price < t.entry && (!l.gap || l.gap.role === "support")))
    .map((l) => ({ name: l.name, price: l.price }));
  if (d) {
    const s200 = d.avg.sma200.value;
    if (s200 !== null && (long ? s200 > t.entry : s200 < t.entry)) pool.push({ name: "sma200", price: s200 });
    const ext = long ? d.high20 : d.low20;
    if (long ? ext > t.entry : ext < t.entry) pool.push({ name: long ? "high_20d" : "low_20d", price: ext });
  }
  pool.sort((a, b) => (long ? a.price - b.price : b.price - a.price));
  const near = pool[0] ?? null;
  const distAdr = near && t.adr > 0 ? Math.abs(near.price - t.entry) / t.adr : null;
  const room = {
    level: near?.name ?? null, price: r(near?.price ?? null, 4), dist_adr: r(distAdr), dist_pct: near ? r((Math.abs(near.price - t.entry) / t.entry) * 100) : null,
    clear: !d || !(t.adr > 0) ? null : near === null ? true : distAdr! > st.trendRoomAdr, within_adr: st.trendRoomAdr,
  };
  // base and go
  let bag: CandidateTrend["base_and_go"] = { ok: null, how: null };
  if (t.setupKey === "gap_and_go" || t.setupKey === "gap_down_and_go") {
    bag = { ok: t.facts.from_base === 1, how: "gap rule's pre-gap base (from_base)" };
  } else if (d) {
    const edge = long ? d.base.top : d.base.bottom;
    const crossed = long ? t.entry > edge && t.prevClose <= edge : t.entry < edge && t.prevClose >= edge;
    bag = { ok: d.base.ok && crossed, how: long ? "trigger close over the base high, yesterday at or under it" : "trigger close under the base low, yesterday at or over it" };
  }
  // vs SPY and the market (SPY's own 50-day)
  const spy = t.spy ?? null;
  if (!spy) missing.push("no SPY daily trend");
  const mine50 = d?.avg.sma50.reclaimUp ?? null, spy50 = spy?.avg.sma50.reclaimUp ?? null;
  const before = !d || !spy ? null : !mine50 && !spy50 ? null : mine50 && !spy50 ? true : !mine50 ? false : mine50.date < spy50!.date;
  const spyNow = spy?.avg.sma50.distNowPct ?? null;
  return {
    v: TREND_VERSION,
    known: !!d,
    as_of: d?.asOf ?? null,
    sessions: d?.sessions ?? null,
    price: t.entry,
    side: t.side,
    ma,
    above_50_and_200: both(true),
    below_50_and_200: both(false),
    tight: { ok: spread === null ? null : spread <= st.trendTightPct, spread_pct: r(spread), max_pct: st.trendTightPct },
    base: d
      ? { ok: d.base.ok, days: d.base.days, high: r(d.base.top, 4), low: r(d.base.bottom, 4), range_pct: r(d.base.rangePct), range_adr: r(d.base.rangeAdr), min_days: st.baseMinDays, max_range_adr: st.baseRangeAdr, measure: "proxy: longest run of sessions to yesterday within the ADR range (gap.ts preGapBase)" }
      : { ok: null, days: null, high: null, low: null, range_pct: null, range_adr: null, min_days: st.baseMinDays, max_range_adr: st.baseRangeAdr, measure: "proxy: longest run of sessions to yesterday within the ADR range (gap.ts preGapBase)" },
    room,
    reclaim,
    vs_spy: {
      off_low_pct: r(d?.offLowPct ?? null), spy_off_low_pct: r(spy?.offLowPct ?? null),
      vs_spy_off_low_pct: d?.offLowPct != null && spy?.offLowPct != null ? r(d.offLowPct - spy.offLowPct) : null,
      sessions: st.trendOffLowSessions, reclaimed_50_before_spy: before, spy_reclaim_50_date: spy50?.date ?? null,
    },
    base_and_go: bag,
    market: {
      spy_above_50: spyNow === null ? null : spyNow > 0, spy_pct_vs_50: r(spyNow),
      spy_reclaim_50_sessions_ago: spy50?.sessionsAgo ?? null,
      spy_reclaimed_50_recent: spy ? (spy50 ? spy50.sessionsAgo <= st.trendReclaimRecent : false) : null,
    },
    missing,
  };
}
