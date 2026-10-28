import type { SymbolFacts } from "./facts";
import { asOf, type MacroData } from "./data/macro";

/** Market regime per trading day (spec section 6), every field from data known by that day's close. */

export type Trend = "rising" | "flat" | "falling";

export interface IndexRegime {
  above50: boolean | null;
  above200: boolean | null;
  slope50: Trend | null;
  slope200: Trend | null;
  drawdownBucket: "<5%" | "5-10%" | "10-20%" | ">20%" | null;
}

export interface RegimeRow {
  /** Row id = the date. */
  date: string;
  spy: IndexRegime;
  qqq: IndexRegime;
  vix: number | null;
  vixBucket: "<15" | "15-20" | "20-30" | ">30" | "unknown";
  vix5d: "rising_fast" | "stable" | "falling" | null;
  vixTerm: number | null;
  termState: "backwardation" | "contango" | null;
  breadthPct50: number | null;
  breadthBucket: "<30%" | "30-60%" | ">60%" | null;
  dgs10: number | null;
  dgs10Change50: Trend | null;
  fedStance: "hiking" | "holding" | "cutting" | "unknown";
  /** Descriptive tags only; never a strategy input. */
  tags: string[];
}

function trend(series: (number | null)[], i: number, lookback: number, flatPct: number): Trend | null {
  const a = series[i];
  const b = i >= lookback ? series[i - lookback] : null;
  if (a == null || b == null || b === 0) return null;
  const ch = a / b - 1;
  return ch > flatPct ? "rising" : ch < -flatPct ? "falling" : "flat";
}

function indexRegime(f: SymbolFacts, i: number): IndexRegime {
  const c = f.bars[i].close;
  const s50 = f.sma50[i];
  const s200 = f.sma200[i];
  const h52 = f.high52[i];
  let dd: IndexRegime["drawdownBucket"] = null;
  if (h52 != null) {
    const d = 1 - c / h52;
    dd = d < 0.05 ? "<5%" : d < 0.1 ? "5-10%" : d < 0.2 ? "10-20%" : ">20%";
  }
  return {
    above50: s50 == null ? null : c > s50,
    above200: s200 == null ? null : c > s200,
    slope50: trend(f.sma50, i, 20, 0.005),
    slope200: trend(f.sma200, i, 20, 0.0025),
    drawdownBucket: dd,
  };
}

const PRESIDENTS: [string, string, string][] = [
  ["2009-01-20", "2017-01-20", "president:Obama(D)"],
  ["2017-01-20", "2021-01-20", "president:Trump(R)"],
  ["2021-01-20", "2025-01-20", "president:Biden(D)"],
  ["2025-01-20", "2099-01-01", "president:Trump(R)"],
];
const EVENTS: [string, string, string][] = [
  ["2018-03-01", "2019-12-13", "tariff_shock_2018_19"],
  ["2020-02-19", "2020-03-23", "covid_crash"],
  ["2020-03-24", "2020-08-18", "covid_recovery"],
  ["2022-01-03", "2022-10-12", "bear_2022"],
  ["2023-03-08", "2023-05-01", "bank_crisis_2023"],
  ["2025-04-02", "2025-05-12", "tariff_shock_2025"],
];
const ELECTIONS = ["2016-11-08", "2018-11-06", "2020-11-03", "2022-11-08", "2024-11-05", "2026-11-03"];
const SHOCK_STARTS: [string, string][] = [
  ["2022-02-24", "ukraine_war_shock"],
  ["2023-10-07", "israel_war_shock"],
];

function eventTags(dates: string[], i: number): string[] {
  const d = dates[i];
  const tags: string[] = [];
  for (const [a, b, t] of PRESIDENTS) if (d >= a && d < b) tags.push(t);
  for (const [a, b, t] of EVENTS) if (d >= a && d <= b) tags.push(t);
  for (const e of ELECTIONS) {
    let k = dates.findIndex((x) => x >= e);
    if (k < 0) k = dates.length + Math.round((Date.parse(e) - Date.parse(dates[dates.length - 1])) / 86_400_000 * (5 / 7));
    if (i >= k - 30 && i <= k + 10) tags.push(`election_window:${e}`);
  }
  for (const [s, t] of SHOCK_STARTS) {
    const k = dates.findIndex((x) => x >= s);
    if (k >= 0 && i >= k && i < k + 30) tags.push(t);
  }
  return tags;
}

function fedStance(macro: MacroData, date: string): RegimeRow["fedStance"] {
  if (macro.fedUpper.size === 0) return "unknown";
  const now = asOf(macro.fedUpper, date, 10);
  if (now == null) return "unknown";
  const keys = [...macro.fedUpper.keys()].filter((k) => k <= date).sort();
  for (let k = keys.length - 1; k >= 0; k--) {
    const v = macro.fedUpper.get(keys[k]) as number;
    if (v !== now) {
      const daysSince = (Date.parse(date) - Date.parse(keys[k + 1] ?? date)) / 86_400_000;
      if (daysSince > 60) return "holding";
      return now > v ? "hiking" : "cutting";
    }
  }
  return "holding";
}

export function buildRegimes(spy: SymbolFacts, qqq: SymbolFacts, macro: MacroData, breadth: Map<string, number>): Map<string, RegimeRow> {
  const out = new Map<string, RegimeRow>();
  const qIdx = new Map(qqq.dates.map((d, i) => [d, i]));
  const dgsDates = [...macro.dgs10.keys()].sort();
  for (let i = 0; i < spy.dates.length; i++) {
    const date = spy.dates[i];
    const vix = asOf(macro.vix, date);
    const vix5 = i >= 5 ? asOf(macro.vix, spy.dates[i - 5]) : null;
    const v3 = asOf(macro.vix3m, date);
    const br = breadth.get(date) ?? null;
    const y = asOf(macro.dgs10, date);
    let yPrev: number | null = null;
    if (y != null) {
      const before = dgsDates.filter((d) => d <= date);
      if (before.length > 50) yPrev = macro.dgs10.get(before[before.length - 51]) ?? null;
    }
    const qi = qIdx.get(date);
    const vixCh = vix != null && vix5 != null ? vix / vix5 - 1 : null;
    out.set(date, {
      date,
      spy: indexRegime(spy, i),
      qqq: qi != null ? indexRegime(qqq, qi) : { above50: null, above200: null, slope50: null, slope200: null, drawdownBucket: null },
      vix,
      vixBucket: vix == null ? "unknown" : vix < 15 ? "<15" : vix < 20 ? "15-20" : vix < 30 ? "20-30" : ">30",
      vix5d: vixCh == null ? null : vixCh > 0.15 ? "rising_fast" : vixCh < -0.1 ? "falling" : "stable",
      vixTerm: vix != null && v3 != null ? vix / v3 : null,
      termState: vix != null && v3 != null ? (vix / v3 > 1 ? "backwardation" : "contango") : null,
      breadthPct50: br,
      breadthBucket: br == null ? null : br < 0.3 ? "<30%" : br <= 0.6 ? "30-60%" : ">60%",
      dgs10: y,
      dgs10Change50: y != null && yPrev != null ? (y - yPrev > 0.25 ? "rising" : y - yPrev < -0.25 ? "falling" : "flat") : null,
      fedStance: fedStance(macro, date),
      tags: eventTags(spy.dates, i),
    });
  }
  return out;
}
