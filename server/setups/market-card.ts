/**
 * The daily market card and "what to watch" list, ported from the research branch:
 *   card  = research/market/state.cjs (label, inputs, index history on same-label days, leadership detectors for the
 *           AI group and the leading group, the staged rule's state, destination ranks)
 *   watch = research/thismarket/watch.cjs + markers.cjs (stress downtrend, live episode, leadership unwind, the
 *           group that held up, inputs, the six turn markers)
 * Detectors and the staged rule: research/thismarket/detectors.cjs. Every value on date D uses data up to D's close.
 *
 * What MarketFlow does not have, and what stands in (each card and list says so in `sources`):
 *   - the Cboe VIX: "VIX >= 20" is the research's own VIXY stand-in (harness.cjs): SPY 20-day realized volatility
 *     in the top 30% of its past year, or VIXY 10%+ above its 50-day; "VIX 15% below its 10-day high" uses VIXY.
 *   - stock history before MarketFlow's bars (2024-07, wide from 2025-06): breadth, new highs/lows and same-label
 *     history start there, not 2018-19; the markers' track record (signals, lows caught, false alarms) is the
 *     research's, fixed at its run, not recomputed here.
 *   - the research's event history for every tested setup (the card's setup table): not in MarketFlow; the card
 *     lists the day's Leader Shakeout and earnings gap up hits from MarketFlow's own tables instead.
 * History, not advice.
 */
import { smaAt, type DBar } from "./daily-math";
import type { MarketLabel } from "./market-label";

export const CARD_VERSION = "card-2026-11-20";
export const MIN_BREADTH_NAMES = 100;
export const THEME_ETF: [string, string][] = [
  ["STORAGE", "SKYY"], ["ENERGY", "XLE"], ["CYBER", "HACK"], ["FIBER_OPTICAL", "SOXX"], ["DATA_CENTER_REITS", "XLRE"],
  ["INDUSTRIAL_INFRA", "VIS"], ["TRANSPORTS", "XTN"], ["FINANCIAL_CORE", "XLF"], ["PAYMENTS_FINTECH", "IPAY"],
  ["CONSUMER_DISC", "RTH"], ["CONSUMER_STAPLES", "XLP"], ["DEFENSE", "ITA"], ["CRYPTO_EQ", "BLOK"], ["HEALTHCARE", "VHT"],
  ["MATERIALS_METALS", "XLB"], ["SEMIS", "SOXX"], ["AI_INFRA", "PAVE"], ["HOMEBUILDERS", "ITB"], ["QUANTUM", "QTUM"],
  ["PRECIOUS_METALS", "GDXJ"], ["BIOTECH", "IBB"], ["SOLAR", "TAN"], ["GAMING_CASINOS", "BJK"],
  ["HOSPITALITY_LEISURE", "PEJ"], ["NUCLEAR_URANIUM", "NLR"], ["RARE_EARTH", "REMX"],
]; // research/inventory/theme_etf_fit.csv, best ETF per theme, listed by Jan 2019 (as markers.cjs and state.cjs filter it)
export const AI_THEMES = ["AI_INFRA", "SEMIS", "FIBER_OPTICAL", "STORAGE", "DATA_CENTER_REITS", "NUCLEAR_URANIUM", "QUANTUM"];
export const CARD_ETFS = [...new Set(["SPY", "QQQ", "IWM", "VIXY", "RSP", "XLP", "XLU", "XLV", "SMH", ...THEME_ETF.map(([, e]) => e)])];

/** The research's record for each turn marker (watch.cjs on 2026-11-19, Cboe VIX, bars from 2018). Fixed reference. */
export const RESEARCH_MARKER_RECORD: Record<string, { signals: number; lowsCaught: string; falseAlarms: number; medianLead: number; spy20: string }> = {
  vixPeak: { signals: 22, lowsCaught: "7 of 8", falseAlarms: 13, medianLead: -1, spy20: "+0.5% (59% up)" },
  breadthThrust: { signals: 8, lowsCaught: "3 of 8", falseAlarms: 5, medianLead: -12, spy20: "+3.1% (88% up)" },
  breadthTurn: { signals: 19, lowsCaught: "8 of 8", falseAlarms: 7, medianLead: -4, spy20: "+3.0% (74% up)" },
  nhOverNl: { signals: 13, lowsCaught: "5 of 8", falseAlarms: 6, medianLead: -4, spy20: "-0.1% (54% up)" },
  ftd: { signals: 11, lowsCaught: "5 of 8", falseAlarms: 6, medianLead: -6, spy20: "+0.1% (55% up)" },
  higherLows: { signals: 11, lowsCaught: "5 of 8", falseAlarms: 6, medianLead: 1, spy20: "+3.0% (55% up)" },
};
/** Finished stress episodes since late 2018 in the research (Cboe VIX): their depths, for "how deep so far". */
export const RESEARCH_EPISODE_DEPTHS = [-0.19, -0.34, -0.13, -0.23, -0.24, -0.10, -0.19, -0.09];

export const SOURCES = {
  volatility: "VIXY proxy: SPY 20-day realized volatility in its top 30% of the past year, or VIXY 10%+ above its 50-day (no Cboe VIX in MarketFlow)",
  missing: ["Cboe VIX (research used Cboe's VIX_History.csv)", "stock bars before 2024-07 (breadth, new highs/lows and same-label history start with MarketFlow's bars)", "the research's event history of every tested setup (card's setup table)"],
};

export interface CardData {
  /** ETF and index bars (CARD_ETFS), oldest first, with a few years of history. */
  etf: Record<string, DBar[]>;
  labels: Map<string, MarketLabel>;
  /** Share of liquid names at a 252-day closing high / low. */
  nhnl: Map<string, { nh: number; nl: number; n: number }>;
  /** Theme id -> member closes (date -> close), for group breadth and leaders. */
  members: Record<string, string[]>;
  stock: Map<string, { pos: Map<string, number>; close: Float64Array; sma50?: Float64Array }>;
  /** Share of themes whose members' median rose, per date. */
  themeBreadth: Map<string, { share: number; n: number }>;
  /** MarketFlow theme rank per theme and date (theme_snapshots). */
  mfRank: (theme: string, date: string) => number;
}

const fin = (x: number) => (Number.isFinite(x) ? x : null);

export function makeCtx(data: CardData) {
  const spy = data.etf.SPY ?? [];
  const days = spy.map((x) => x.date);
  const SP = new Map(days.map((d, i) => [d, i]));
  const pos: Record<string, Map<string, number>> = {};
  for (const [s, b] of Object.entries(data.etf)) pos[s] = new Map(b.map((x, i) => [x.date, i]));
  const at = (s: string, d: string, k = 0) => { const b = data.etf[s], i = pos[s]?.get(d); return !b || i === undefined || i + k < 0 ? NaN : b[i + k].close; };
  const sma = (s: string, d: string, n: number, k = 0) => { const b = data.etf[s], i = pos[s]?.get(d); return !b || i === undefined ? NaN : smaAt(b, i + k, n); };
  const rel = (s: string, d: string, n: number) => (at(s, d) / at(s, d, -n)) / (at("SPY", d) / at("SPY", d, -n)) - 1;
  const stockAt = (s: string, d: string, k = 0) => { const o = data.stock.get(s), i = o?.pos.get(d); return !o || i === undefined || i + k < 0 ? NaN : o.close[i + k]; };
  for (const o of data.stock.values()) {
    if (o.sma50) continue;
    const a = new Float64Array(o.close.length).fill(NaN); let t = 0;
    for (let i = 0; i < o.close.length; i++) { t += o.close[i]; if (i >= 50) t -= o.close[i - 50]; if (i >= 49) a[i] = t / 50; }
    o.sma50 = a;
  }
  const stockSma = (s: string, d: string, n: number) => {
    const o = data.stock.get(s), i = o?.pos.get(d); if (!o || i === undefined || i < n - 1) return NaN;
    if (n === 50) return o.sma50![i];
    let t = 0; for (let j = i - n + 1; j <= i; j++) t += o.close[j]; return t / n;
  };
  const groupBreadth = (mem: string[], d: string) => { const v = mem.map((s) => { const c = stockAt(s, d), m = stockSma(s, d, 50); return Number.isFinite(c) && Number.isFinite(m) ? (c > m ? 1 : 0) : null; }).filter((x): x is 0 | 1 => x !== null); return v.length >= 5 ? v.reduce<number>((a, b) => a + b, 0) / v.length : NaN; };
  const br = (d: string) => data.labels.get(d)?.breadth ?? NaN;
  const vixy = (d: string) => at("VIXY", d);
  const volHigh = (d: string) => data.labels.get(d)?.volHigh ?? false;
  const memOf = (themes: string[]) => [...new Set(themes.flatMap((t) => data.members[t] ?? []))].filter((s) => data.stock.has(s));
  /** A label counts for same-label history only where breadth had at least this many names behind it. */
  const hasLabel = (d: string) => (data.labels.get(d)?.breadthN ?? 0) >= MIN_BREADTH_NAMES;
  return { data, spy, days, SP, pos, at, sma, rel, stockAt, stockSma, groupBreadth, br, vixy, volHigh, memOf, hasLabel };
}
export type Ctx = ReturnType<typeof makeCtx>;

// ---- watch list (markers.cjs + watch.cjs) ---------------------------------------------------------------------------
export function stressSeries(c: Ctx): Map<string, boolean> {
  const out = new Map<string, boolean>();
  c.days.forEach((d, i) => {
    let hi = 0; for (let j = Math.max(0, i - 251); j <= i; j++) hi = Math.max(hi, c.spy[j].close);
    // research: VIX >= 20 and SPY under a falling 50-day and 5%+ off its 52-week closing high
    out.set(d, c.volHigh(d) && c.at("SPY", d) < c.sma("SPY", d, 50) && c.sma("SPY", d, 50) < c.sma("SPY", d, 50, -10) && c.spy[i].close / hi - 1 <= -0.05);
  });
  return out;
}

export const MARKERS: Record<string, string> = {
  vixPeak: "Volatility peaked: VIXY closes 15%+ below its 10-day high while volatility is still high (research: VIX 15% below its 10-day high while >= 20)",
  breadthThrust: "Breadth thrust: share above 50d goes from <= 25% to >= 55% within 15 sessions",
  breadthTurn: "Share above 50d turns up: +10 points in 5 sessions from under 30%",
  nhOverNl: "New highs beat new lows again (after new lows led for 5+ sessions)",
  ftd: "Follow-through day: SPY +1.25%+ on higher volume, day 4-10 of a rally from a 20-day low",
  higherLows: "Leaders make higher lows: 60%+ of theme ETFs above their 10-day low while SPY makes a new 10-day low",
};

export function markerFires(c: Ctx, stress: Map<string, boolean>, upTo: string): Record<string, string[]> {
  const ds = c.days.filter((d) => d <= upTo);
  const nh = (d: string) => c.data.nhnl.get(d);
  const etfs = [...new Set(THEME_ETF.map(([, e]) => e))].filter((e) => c.data.etf[e]?.length);
  const f: Record<string, (d: string, k: number) => boolean> = {
    vixPeak: (d, k) => {
      const w = ds.slice(Math.max(0, k - 9), k + 1).map(c.vixy), w0 = ds.slice(Math.max(0, k - 10), k).map(c.vixy);
      return c.volHigh(d) && c.vixy(d) <= 0.85 * Math.max(...w) && c.vixy(ds[k - 1]) > 0.85 * Math.max(...w0);
    },
    breadthThrust: (d, k) => c.br(d) >= 0.55 && c.br(ds[k - 1]) < 0.55 && Math.min(...ds.slice(Math.max(0, k - 15), k).map(c.br)) <= 0.25,
    breadthTurn: (d, k) => c.br(d) - c.br(ds[k - 5]) >= 0.1 && Math.min(...ds.slice(k - 5, k).map(c.br)) < 0.3 && !(c.br(ds[k - 1]) - c.br(ds[k - 6]) >= 0.1),
    nhOverNl: (d, k) => { const t = nh(d); return !!t && t.nh > t.nl && ds.slice(k - 5, k).every((x) => { const y = nh(x); return !!y && y.nl > y.nh; }); },
    ftd: (d) => {
      const i = c.SP.get(d)!, s = c.spy;
      if (s[i].close / s[i - 1].close - 1 < 0.0125 || s[i].volume <= s[i - 1].volume) return false;
      let lowI = i; for (let j = i - 10; j <= i; j++) if (s[j].close < s[lowI].close) lowI = j;
      const day = i - lowI; if (day < 3 || day > 9) return false;
      let lo20 = Infinity; for (let j = lowI - 20; j < lowI; j++) lo20 = Math.min(lo20, s[j].close);
      return s[lowI].close <= lo20;
    },
    higherLows: (d) => {
      const i = c.SP.get(d)!; let lo = Infinity; for (let j = i - 10; j < i; j++) lo = Math.min(lo, c.spy[j].close);
      if (c.spy[i].close > lo) return false;
      const ok = etfs.filter((s) => { const b = c.data.etf[s], j = c.pos[s]?.get(d) ?? -1; if (j < 11) return false; let l = Infinity; for (let q = j - 10; q < j; q++) l = Math.min(l, b[q].close); return b[j].close > l; }).length;
      return etfs.length > 0 && ok / etfs.length >= 0.6;
    },
  };
  const recentStress = (k: number) => { for (let j = Math.max(0, k - 20); j <= k; j++) if (stress.get(ds[j])) return true; return false; };
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(MARKERS)) {
    const raw: string[] = [];
    ds.forEach((d, k) => { if (k < 26 || !recentStress(k)) return; try { if (f[key](d, k)) raw.push(d); } catch { /* missing data that day */ } });
    out[key] = raw.filter((d, j) => j === 0 || c.SP.get(d)! - c.SP.get(raw[j - 1])! > 5);
  }
  return out;
}

export function watchSeries(c: Ctx) {
  const stress = stressSeries(c);
  return { stress, fires: markerFires(c, stress, c.days[c.days.length - 1]) };
}

export function buildWatch(c: Ctx, D: string, pre = watchSeries(c)) {
  const stress = pre.stress;
  const ds = c.days.filter((d) => d <= D);
  const kD = ds.length - 1;
  // episodes: runs of stress days with gaps of up to 10 sessions; at least 3 stress days unless it is the live one
  const eps: { start: string; end: string; n: number }[] = [];
  let cur: { start: string; end: string; n: number } | null = null, gap = 0;
  for (const d of ds) { if (stress.get(d)) { if (cur && gap <= 10) { cur.end = d; cur.n++; } else { cur = { start: d, end: d, n: 1 }; eps.push(cur); } gap = 0; } else gap++; }
  for (let j = eps.length - 1; j >= 0; j--) if (eps[j].n < 3 && eps[j].end !== D) eps.splice(j, 1);
  const iD = c.SP.get(D)!;
  const finished = (e: { start: string; end: string }) => {
    let lo = Infinity, loI = -1; const iS = c.SP.get(e.start)!, iE = Math.min(c.SP.get(e.end)! + 20, iD);
    for (let j = iS; j <= iE; j++) if (c.spy[j].close < lo) { lo = c.spy[j].close; loI = j; }
    return c.SP.get(e.end)! + 20 < iD && loI + 15 < iD;
  };
  const live = eps.length && !finished(eps[eps.length - 1]) ? eps[eps.length - 1] : null;
  let hi = 0; for (let j = Math.max(0, iD - 251); j <= iD; j++) hi = Math.max(hi, c.spy[j].close);
  const spyFromHigh = c.spy[iD].close / hi - 1;
  const etfs = [...new Set(THEME_ETF.map(([, e]) => e))].filter((e) => c.data.etf[e]?.length);
  const themeOf = (s: string) => THEME_ETF.filter(([, e]) => e === s).map(([t]) => t).join("/") || s;
  const unwinding = etfs.map((s) => [s, c.rel(s, D, 250), c.rel(s, D, 60)] as const).filter((x) => Number.isFinite(x[1]) && x[1] >= 0.15 && x[2] <= -0.08).map((x) => x[0]);
  const unwind = !!stress.get(D) && unwinding.length > 0 && c.rel("RSP", D, 20) > 0;
  let holding: { etf: string; theme: string; vs50: number | null } | null = null;
  if (live) {
    const iS = c.SP.get(live.start)!;
    const r = etfs.map((s) => [s, (c.at(s, c.spy[iS].date) / c.at(s, c.spy[iS - 60]?.date ?? "")) / (c.spy[iS].close / c.spy[iS - 60].close) - 1] as const).filter((x) => Number.isFinite(x[1])).sort((a, b) => b[1] - a[1]);
    if (r.length) holding = { etf: r[0][0], theme: themeOf(r[0][0]), vs50: fin(c.at(r[0][0], D) / c.sma(r[0][0], D, 50) - 1) };
  }
  const fires = Object.fromEntries(Object.entries(pre.fires).map(([k, v]) => [k, v.filter((d) => d <= D)]));
  const vxW = ds.slice(Math.max(0, kD - 9), kD + 1).map(c.vixy);
  const brW = ds.slice(Math.max(0, kD - 15), kD).map(c.br).filter(Number.isFinite);
  const t = c.data.nhnl.get(D);
  return {
    version: CARD_VERSION,
    date: D,
    stress: !!stress.get(D),
    stressRule: "volatility high (VIXY proxy) and SPY under a falling 50-day and 5%+ off its 52-week closing high",
    liveEpisode: live && { start: live.start, sessions: c.SP.get(D)! - c.SP.get(live.start)! + 1 },
    spyFromHigh: fin(spyFromHigh),
    depthAgainstResearchEpisodes: live ? { deeper: RESEARCH_EPISODE_DEPTHS.filter((x) => x < spyFromHigh).length, of: RESEARCH_EPISODE_DEPTHS.length, depths: RESEARCH_EPISODE_DEPTHS } : null,
    unwind,
    unwinding: unwinding.map(themeOf),
    holdingGroup: holding,
    inputs: {
      vixy: fin(c.vixy(D)), vixyVs10dHigh: fin(c.vixy(D) / Math.max(...vxW) - 1), volHigh: c.volHigh(D), rvPct: c.data.labels.get(D)?.rvPct ?? null,
      breadth: fin(c.br(D)), breadth5dChange: fin(c.br(D) - c.br(ds[kD - 5])), breadthMin15: brW.length ? Math.min(...brW) : null,
      newHighs: t ? t.nh : null, newLows: t ? t.nl : null, nhnlNames: t?.n ?? 0, rspVsSpy20: fin(c.rel("RSP", D, 20)),
    },
    markers: Object.entries(MARKERS).map(([key, name]) => ({
      key, name,
      firedToday: fires[key].includes(D),
      recent: fires[key].filter((d) => d !== D && c.SP.get(D)! - c.SP.get(d)! <= 10),
      researchRecord: RESEARCH_MARKER_RECORD[key],
    })),
    sources: { ...SOURCES, record: "markers' signals / lows caught / false alarms: the research's record to 2026-11-19 (Cboe VIX), not recomputed here" },
  };
}

// ---- card (state.cjs + detectors.cjs) -----------------------------------------------------------------------------
type Stat = { n: number; mean?: number; med?: number; hit?: number };
const sum = (v: number[]): Stat => { v = v.filter(Number.isFinite); if (!v.length) return { n: 0 }; const s = [...v].sort((a, b) => a - b); return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, med: s[s.length >> 1], hit: v.filter((x) => x > 0).length / v.length }; };

export function detectorsFor(c: Ctx, g: { etf: string; members: string[]; theme: string | null }, from: string, to: string) {
  const { etf: G, members, theme } = g;
  const days = c.days.filter((d) => d <= to);
  const above50 = (d: string) => c.at(G, d) > c.sma(G, d, 50);
  const leadersOf = (d: string) => members.map((s) => [s, c.stockAt(s, d, -20) / c.stockAt(s, d, -140) - 1] as const).filter((x) => Number.isFinite(x[1])).sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0]);
  const distCount = (d: string) => { const b = c.data.etf[G]; if (!b) return 0; const i = c.pos[G]?.get(d) ?? -1; if (i < 26) return 0; let n = 0; for (let j = i - 24; j <= i; j++) if (b[j].close / b[j - 1].close - 1 <= -0.002 && b[j].volume > b[j - 1].volume) n++; return n; };
  const weekEnds: string[] = [];
  for (let k = 0; k < days.length; k++) { const a = new Date(days[k] + "T12:00:00Z"), b = days[k + 1] ? new Date(days[k + 1] + "T12:00:00Z") : null; if (!b || b.getUTCDay() <= a.getUTCDay() || b.getTime() - a.getTime() > 3 * 864e5) weekEnds.push(days[k]); }
  const wkPos = new Map(weekEnds.map((d, k) => [d, k]));
  const wkSma = (k: number, n = 30) => { if (k < n - 1) return NaN; let t = 0; for (let j = k - n + 1; j <= k; j++) t += c.at(G, weekEnds[j]); return t / n; };
  const D: Record<string, { name: string; f: ((d: string) => boolean | null) | null }> = {
    rs20neg: { name: "Relative strength vs SPY over 20 days turns negative", f: (d) => c.rel(G, d, 20) < 0 },
    rs60neg: { name: "Relative strength vs SPY over 60 days turns negative", f: (d) => c.rel(G, d, 60) < 0 },
    under50: { name: "ETF closes under its 50-day", f: (d) => !above50(d) },
    failedReclaim: { name: "ETF fails its first reclaim of the 50-day (back under within 5 sessions)", f: null },
    under200: { name: "ETF closes under its 200-day", f: (d) => c.at(G, d) < c.sma(G, d, 200) },
    breadth50: { name: "Under half of the group's members above their 50-day", f: members.length ? (d) => c.groupBreadth(members, d) < 0.5 : null },
    leadersLose50: { name: "3 of the top 5 members (by prior strength) under their 50-day while the ETF is above it", f: members.length ? (d) => { if (!above50(d)) return false; const L = leadersOf(d); return L.length >= 5 && L.filter((s) => c.stockAt(s, d) < c.stockSma(s, d, 50)).length >= 3; } : null },
    mfRankDrop: { name: "MarketFlow theme rank falls 5+ places in 10 sessions", f: theme ? (d) => { const i = c.SP.get(d) ?? -1; const r0 = c.data.mfRank(theme, days[i - 10]), r1 = c.data.mfRank(theme, d); return Number.isFinite(r0) && Number.isFinite(r1) && r1 - r0 >= 5; } : null },
    ewBeatsCw: { name: "Equal weight (RSP) beats SPY by 1%+ over 20 days", f: (d) => c.rel("RSP", d, 20) > 0.01 },
    defensives: { name: "Staples (XLP) and utilities (XLU) both beat SPY by 2%+ over 20 days", f: (d) => c.rel("XLP", d, 20) > 0.02 && c.rel("XLU", d, 20) > 0.02 },
    distDays: { name: "5+ distribution days on the ETF in 25 sessions", f: (d) => distCount(d) >= 5 },
    stage4: { name: "Weinstein stage 3 to 4: weekly close under a falling 30-week average", f: (d) => { const k = wkPos.get(d); if (k === undefined) return null; return c.at(G, d) < wkSma(k) && wkSma(k) < wkSma(k - 4); } },
  };
  const transitions = (fn: (d: string) => boolean | null) => { const out: string[] = []; let prev: boolean | null = null; for (const d of days) { if (d < from || d > to) continue; let v: boolean; try { v = !!fn(d); } catch { v = false; } if (v && prev === false) out.push(d); prev = v; } return out; };
  const fires: Record<string, string[] | null> = {};
  for (const [key, x] of Object.entries(D)) {
    if (key === "failedReclaim") {
      const out: string[] = []; let st = "above", mark = 0, run = 0;
      days.forEach((d, k) => { if (d < from || d > to) return; const a = above50(d); run = a ? run + 1 : 0;
        if (st === "above" && !a) st = "under";
        else if (st === "under" && a) { st = "reclaim"; mark = k; }
        else if (st === "reclaim") { if (!a && k - mark <= 5) { out.push(d); st = "failed"; } else if (k - mark > 5) st = "above"; }
        else if (st === "failed" && run >= 6) st = "above"; });
      fires[key] = out; continue;
    }
    if (!x.f) { fires[key] = null; continue; }
    if (key === "stage4") { const out: string[] = []; let prev: boolean | null = null; for (const d of weekEnds) { if (d < from || d > to) continue; const v = !!x.f(d); if (v && prev === false) out.push(d); prev = v; } fires[key] = out; continue; }
    fires[key] = transitions(x.f);
  }
  return { D, fires };
}

/** The staged watch / reduce / out / back-in rule (detect_sim.cjs via detectors.cjs simulate), replayed i0..i1. */
export function stagedState(c: Ctx, G: string, mem: string[], i0: number, i1: number): string {
  let st = "IN", reclaimMark: number | null = null;
  let lastChange: { d: string; st: string } | null = null;
  for (let k = i0; k < i1; k++) {
    const d = c.days[k], dn = c.days[k + 1];
    if (!Number.isFinite(c.at(G, dn) / c.at(G, d) - 1)) continue;
    const cl = c.at(G, d), m50 = c.sma(G, d, 50), m50p = c.sma(G, d, 50, -5), m200 = c.sma(G, d, 200), rs20 = c.rel(G, d, 20), rs60 = c.rel(G, d, 60);
    const above = cl > m50, prev = st;
    if (st === "IN" && !above && rs20 < 0) { st = "REDUCE"; reclaimMark = null; }
    else if (st === "REDUCE") {
      if (above && reclaimMark === null) reclaimMark = k;
      const failed = reclaimMark !== null && !above && k - reclaimMark <= 5;
      if (above && m50 > m50p && rs20 > 0) st = "IN";
      else if (failed || rs60 < 0 || cl < m200) st = "OUT";
      if (reclaimMark !== null && k - reclaimMark > 5) reclaimMark = null;
    } else if (st === "OUT" && above && m50 > m50p && rs20 > 0) st = "IN";
    if (st !== prev) lastChange = { d, st };
  }
  void mem; // the research's watch count uses members only for its log; the state does not depend on it
  return lastChange ? `${lastChange.st} since ${lastChange.d}` : "IN all year";
}

export function buildCard(c: Ctx, D: string, extra: { setupsToday?: unknown; mfRegime?: string | null } = {}) {
  const lab = c.data.labels.get(D);
  if (!lab) return null;
  const labelled = c.days.filter((d) => d < D && c.hasLabel(d));
  const iAs = c.SP.get(D)!;
  const allDays = labelled.filter((d) => c.SP.get(d)! + 20 < iAs);
  const past = allDays.filter((d) => c.data.labels.get(d)!.label === lab.label);
  const fwd = (sym: string, n: number, set: string[]) => set.filter((d) => c.SP.get(d)! + n < iAs).map((d) => c.at(sym, d, n) / c.at(sym, d) - 1);
  const index = Object.fromEntries(["SPY", "QQQ", "IWM"].map((s) => [s, Object.fromEntries([1, 5, 20, 60].map((n) => [`${n}d`, { label: sum(fwd(s, n, past)), all: sum(fwd(s, n, allDays)) }]))]));

  // leadership detectors: the AI group and the leading group now (best 120-day RS among the theme ETFs)
  const fit = THEME_ETF.filter(([, e]) => c.data.etf[e]?.length);
  const lead = fit.map(([t, e]) => [t, e, c.rel(e, D, 120)] as const).filter((x) => Number.isFinite(x[2])).sort((a, b) => b[2] - a[2])[0];
  const xi = c.SP.get(D)!;
  const from = c.days[Math.max(0, xi - 260)];
  const groups = [
    { label: "AI group", etf: "SMH", members: c.memOf(AI_THEMES), theme: "SEMIS" },
    ...(lead ? [{ label: `Leading group now (${lead[0]}, best 120-day RS)`, etf: lead[1], members: c.memOf([lead[0]]), theme: lead[0] }] : []),
  ];
  const detectors = groups.map((g) => {
    const { D: defs, fires } = detectorsFor(c, g, from, D);
    const rows = Object.entries(defs).map(([key, x]) => {
      const f = fires[key];
      if (!f) return { key, name: x.name, state: "n/a" };
      const recent = f.filter((d) => c.SP.get(d)! >= xi - 10);
      if (!x.f) return { key, name: x.name, state: "event", lastFired: f.length ? f[f.length - 1] : null };
      let on = false; try { on = !!x.f(D); } catch { on = false; }
      return { key, name: x.name, state: on ? "ON" : "off", firedRecently: recent.length ? recent[recent.length - 1] : null };
    });
    return { group: g.label, etf: g.etf, members: g.members.length, detectors: rows, stagedRule: stagedState(c, g.etf, g.members, Math.max(260, xi - 250), xi) };
  });
  const dest = fit.map(([t, e]) => {
    const rs = c.rel(e, D, 20), rsP = c.rel(e, c.days[xi - 5], 20), br = c.groupBreadth(c.memOf([t]), D), ab = c.at(e, D) > c.sma(e, D, 50);
    return { theme: t, etf: e, rs20: fin(rs), rsRising: rs > rsP, breadth: fin(br), aboveSma50: ab, qualifies: rs > rsP && br > 0.5 && ab };
  }).filter((x) => x.rs20 !== null).sort((a, b) => b.rs20! - a.rs20!);
  const tb = c.data.themeBreadth.get(D);
  return {
    version: CARD_VERSION,
    asOf: D,
    label: lab.label,
    mfRegime: extra.mfRegime ?? null,
    inputs: { ...lab, themeBreadth: tb ? tb.share : null, themesCounted: tb?.n ?? 0 },
    sameLabelDays: past.length,
    labelHistoryDays: allDays.length,
    labelHistoryFrom: labelled[0] ?? null,
    index,
    detectors,
    destinations: { top: dest.slice(0, 10), ruleA: dest.filter((x) => x.qualifies).slice(0, 3).map((x) => `${x.theme} (${x.etf})`), defensivesVsSpy20: { XLP: fin(c.rel("XLP", D, 20)), XLU: fin(c.rel("XLU", D, 20)), XLV: fin(c.rel("XLV", D, 20)), RSP: fin(c.rel("RSP", D, 20)) } },
    setupsToday: extra.setupsToday ?? null,
    sources: SOURCES,
  };
}
