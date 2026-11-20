/**
 * The research market label for any date (research/market/label.cjs and research/harness/harness.cjs, "study 3"),
 * from data known at that date's close.
 *
 *   trend  = how many of SPY, QQQ, IWM close above their 50- and 200-day SMAs (0-6), plus breadth (share of liquid
 *            stocks, price >= $6 and prior 20-day dollar volume >= $30M, above their own 50-day SMA):
 *            UP when 5-6 and breadth >= 50%; DOWN when 0-1 or breadth < 30%; else CHOP.
 *   volatility HIGH: the research used the Cboe VIX (>= 20, or 10%+ above its 50-day). MarketFlow has no VIX
 *            series, so this uses the research's own stand-in (harness.cjs): SPY's 20-day realized volatility in the
 *            top 30% of its past year, or VIXY closing 10%+ above its 50-day average. Every label says so.
 *   label  = UP_CALM, UP_VOLATILE, CHOP_CALM, CHOP_VOLATILE, DOWN.
 */
import { smaAt, smaSeries, type DBar } from "./daily-math";

export const LABEL_INDEXES = ["SPY", "QQQ", "IWM"] as const;
export const VOL_SOURCE = "VIXY proxy + SPY realized volatility (no Cboe VIX in MarketFlow)";

export interface IndexState {
  close: number;
  vs20: number | null;
  vs50: number | null;
  vs200: number | null;
  slope20: number | null;
  slope50: number | null;
  slope200: number | null;
}

export interface MarketLabel {
  date: string;
  label: string;
  trend: "UP" | "CHOP" | "DOWN";
  trendScore: number;
  breadth: number | null;
  breadthN: number;
  volHigh: boolean;
  rvPct: number | null;
  vixy: number | null;
  vixyVs50: number | null;
  vixy5dChange: number | null;
  volSource: string;
  idx: Record<string, IndexState>;
}

/** Per-date breadth counts: liquid stocks above their 50-day, and liquid stocks with a 50-day. */
export type Breadth = Map<string, { up: number; n: number }>;

const fin = (x: number): number | null => (Number.isFinite(x) ? x : null);

/** Annualized 20-day realized volatility of SPY's log returns, for every index (NaN before 21). */
export function realizedVol(spy: DBar[]): number[] {
  return spy.map((_, i) => {
    if (i < 21) return NaN;
    const r: number[] = [];
    for (let j = i - 19; j <= i; j++) r.push(Math.log(spy[j].close / spy[j - 1].close));
    const m = r.reduce((a, c) => a + c, 0) / r.length;
    return Math.sqrt((r.reduce((a, c) => a + (c - m) ** 2, 0) / (r.length - 1)) * 252);
  });
}

/**
 * Labels for every SPY date in `dates` (or all SPY dates). `index` holds SPY, QQQ, IWM and VIXY daily bars, oldest
 * first, with enough history for a 200-day SMA and a year of realized volatility before the first date wanted.
 */
export function labelDates(index: Record<string, DBar[]>, breadth: Breadth, dates?: Set<string>): Map<string, MarketLabel> {
  const out = new Map<string, MarketLabel>();
  const spy = index.SPY ?? [];
  if (!spy.length) return out;
  const rv = realizedVol(spy);
  const pos: Record<string, Map<string, number>> = {};
  const s50: Record<string, number[]> = {}, s200: Record<string, number[]> = {};
  for (const s of LABEL_INDEXES) {
    const b = index[s] ?? [];
    pos[s] = new Map(b.map((x, k) => [x.date, k]));
    s50[s] = smaSeries(b, 50);
    s200[s] = smaSeries(b, 200);
  }
  const vixy = index.VIXY ?? [];
  const vpos = new Map(vixy.map((x, k) => [x.date, k]));
  const v50 = smaSeries(vixy, 50);

  spy.forEach((x, i) => {
    if (dates && !dates.has(x.date)) return;
    const hist = rv.slice(Math.max(0, i - 252), i + 1).filter(Number.isFinite);
    const rvPct = hist.length > 50 ? hist.filter((v) => v <= rv[i]).length / hist.length : NaN;
    let tr = 0;
    const idx: Record<string, IndexState> = {};
    for (const s of LABEL_INDEXES) {
      const k = pos[s].get(x.date);
      if (k === undefined) continue;
      const b = index[s];
      const c = b[k].close, a20 = smaAt(b, k, 20), a50 = s50[s][k], a200 = s200[s][k];
      if (c > a50) tr++;
      if (c > a200) tr++;
      idx[s] = {
        close: c,
        vs20: fin(c / a20 - 1), vs50: fin(c / a50 - 1), vs200: fin(c / a200 - 1),
        slope20: fin(a20 / smaAt(b, k - 10, 20) - 1),
        slope50: fin(a50 / smaAt(b, k - 10, 50) - 1),
        slope200: fin(a200 / smaAt(b, k - 20, 200) - 1),
      };
    }
    const vk = vpos.get(x.date);
    const vc = vk !== undefined ? vixy[vk].close : NaN;
    const vs50 = vk !== undefined ? v50[vk] : NaN;
    const v5 = vk !== undefined && vk >= 5 ? vixy[vk - 5].close : NaN;
    const volHigh = rvPct >= 0.7 || (vs50 > 0 && vc > 1.1 * vs50);
    const bc = breadth.get(x.date);
    const br = bc && bc.n ? bc.up / bc.n : NaN;
    const trend: MarketLabel["trend"] = tr >= 5 && br >= 0.5 ? "UP" : tr <= 1 || br < 0.3 ? "DOWN" : "CHOP";
    out.set(x.date, {
      date: x.date,
      label: trend === "DOWN" ? "DOWN" : `${trend}_${volHigh ? "VOLATILE" : "CALM"}`,
      trend,
      trendScore: tr,
      breadth: fin(br),
      breadthN: bc?.n ?? 0,
      volHigh: !!volHigh,
      rvPct: fin(rvPct),
      vixy: fin(vc),
      vixyVs50: fin(vc / vs50 - 1),
      vixy5dChange: fin(vc / v5 - 1),
      volSource: VOL_SOURCE,
      idx,
    });
  });
  return out;
}

/** Add one symbol's contribution to the per-date breadth counts (price >= $6, prior 20-day $vol >= $30M). */
export function addBreadth(breadth: Breadth, b: DBar[], dollarVolPrev: (i: number) => number): void {
  const s50 = smaSeries(b, 50);
  for (let i = 0; i < b.length; i++) {
    if (!(dollarVolPrev(i) >= 3e7) || b[i].close < 6 || Number.isNaN(s50[i])) continue;
    const c = breadth.get(b[i].date) ?? { up: 0, n: 0 };
    c.n++;
    if (b[i].close > s50[i]) c.up++;
    breadth.set(b[i].date, c);
  }
}
