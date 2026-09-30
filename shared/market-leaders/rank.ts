/**
 * Point-in-time Market Leaders rank.
 * Bars are oldest-first. A short history fails the gate that needed the missing bars.
 */

import type { MarketLeadersSpec } from "./spec";

export interface LeaderBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GateBit {
  id: "g1" | "g2" | "g3" | "g4" | "g5";
  pass: boolean;
  label: string;
}

export interface PointLine {
  key: "rs" | "rsLine" | "group" | "accumulation" | "fundamentals" | "character";
  label: string;
  points: number;
  note: string;
}

export interface RawScore {
  symbol: string;
  date: string;
  close: number;
  gates: GateBit[];
  passed: boolean;
  volumeBreak: boolean;
  rsValue: number | null;
  themePercentile: number | null;
  themeName: string | null;
  points: PointLine[];
}

export interface ScoredSymbol extends RawScore {
  score: number;
  rsPercentile: number | null;
}

export type LeaderStatus = "on" | "at_risk" | "left";

export interface LeaderRow {
  symbol: string;
  score: number;
  status: LeaderStatus;
  leaveReason: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  daysOnBook: number;
  gates: GateBit[];
  points: PointLine[];
  themeName: string | null;
  close: number;
}

export interface SpanRow {
  symbol: string;
  daysInBook: number;
  joined: string | null;
  left: string | null;
  why: string | null;
  score: number;
  status: LeaderStatus;
  themeName: string | null;
}

export interface WalkResult {
  rows: LeaderRow[];
  left: LeaderRow[];
  span: SpanRow[];
  counts: { onBook: number; atRisk: number; joinedThisWeek: number; droppedThisWeek: number };
}

function smaAt(values: number[], end: number, period: number): number | null {
  if (period < 1 || end < period - 1 || end >= values.length) return null;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i++) sum += values[i];
  return sum / period;
}

function windowExtreme(
  bars: LeaderBar[],
  end: number,
  lookback: number,
  pick: "high" | "low",
): number | null {
  if (end < lookback - 1) return null;
  let value = pick === "high" ? -Infinity : Infinity;
  for (let i = end - lookback + 1; i <= end; i++) {
    const next = bars[i][pick];
    if (pick === "high") value = Math.max(value, next);
    else value = Math.min(value, next);
  }
  return Number.isFinite(value) ? value : null;
}

function avg(values: number[], end: number, period: number): number | null {
  return smaAt(values, end, period);
}

export function scoreSymbol(
  symbol: string,
  bars: LeaderBar[],
  end: number,
  spyCloseByDate: Map<string, number>,
  themePercentile: number | null,
  themeName: string | null,
  spec: MarketLeadersSpec,
): RawScore | null {
  const bar = bars[end];
  if (!bar) return null;
  const closes = bars.map((item) => item.close);
  const volumes = bars.map((item) => item.volume);
  const close = bar.close;
  const smaFast = smaAt(closes, end, spec.smaFast);
  const smaSlow = smaAt(closes, end, spec.smaSlow);
  const smaFastThen = smaAt(closes, end - spec.slopeBars, spec.smaFast);
  const avgDollar = (() => {
    if (end < spec.udvrBars - 1 && end < 49) return null;
    const period = 50;
    if (end < period - 1) return null;
    let sum = 0;
    for (let i = end - period + 1; i <= end; i++) sum += bars[i].close * bars[i].volume;
    return sum / period;
  })();
  const avgVolume = avg(volumes, end, 50);
  const high = windowExtreme(bars, end, spec.lookback, "high");
  const low = windowExtreme(bars, end, spec.lookback, "low");

  const gates: GateBit[] = [
    {
      id: "g1",
      pass: smaFast != null && smaSlow != null && close > smaFast && smaFast > smaSlow,
      label: `Close above the ${spec.smaFast} SMA and ${spec.smaFast} above the ${spec.smaSlow}`,
    },
    {
      id: "g2",
      pass: smaFast != null && smaFastThen != null && smaFast > smaFastThen,
      label: `${spec.smaFast} SMA higher than ${spec.slopeBars} bars ago`,
    },
    {
      id: "g3",
      pass: avgDollar != null && avgDollar >= spec.minDollarVolume && close >= spec.minClose,
      label: `50-day dollar volume at least $${Math.round(spec.minDollarVolume / 1_000_000)}M and close at least $${spec.minClose}`,
    },
    {
      id: "g4",
      pass: high != null && close >= spec.highProximity * high,
      label: `Close at least ${Math.round(spec.highProximity * 100)}% of the ${spec.lookback}-day high`,
    },
    {
      id: "g5",
      pass: low != null && low > 0 && close >= spec.lowExtension * low,
      label: `Close at least ${spec.lowExtension.toFixed(2)}× the ${spec.lookback}-day low`,
    },
  ];

  let rsValue: number | null = null;
  const perf = (days: number) => {
    const then = closes[end - days];
    if (then == null || then <= 0 || end < days) return null;
    return close / then - 1;
  };
  const p63 = perf(63);
  const p126 = perf(126);
  const p252 = perf(252);
  if (p63 != null && p126 != null && p252 != null) rsValue = 2 * p63 + p126 + p252;

  let rsLinePoints = 0;
  let rsLineNote = "RS line needs a full lookback against SPY";
  if (end >= spec.lookback - 1) {
    const series: number[] = [];
    for (let i = end - spec.lookback + 1; i <= end; i++) {
      const spy = spyCloseByDate.get(bars[i].date);
      if (spy && spy > 0) series.push(bars[i].close / spy);
    }
    if (series.length >= spec.lookback) {
      let maxIdx = 0;
      for (let i = 1; i < series.length; i++) if (series[i] >= series[maxIdx]) maxIdx = i;
      const fresh = maxIdx >= series.length - spec.rsLineWindow;
      rsLinePoints = fresh ? 10 : 0;
      rsLineNote = fresh
        ? `RS line high is inside ${spec.rsLineWindow} bars`
        : "RS line high is older than the window";
    }
  }

  let groupPoints = 0;
  let groupNote = "No daily theme rank for this date";
  if (themePercentile != null) {
    if (themePercentile <= spec.groupTop) {
      groupPoints = 20;
      groupNote = "Theme is in the top quarter";
    } else if (themePercentile <= spec.groupMid) {
      groupPoints = 10;
      groupNote = "Theme is in the top half";
    } else {
      groupNote = "Theme is outside the top half";
    }
  }

  let udvrPoints = 0;
  let udvrNote = "Up/down volume needs more bars";
  if (end >= spec.udvrBars) {
    let up = 0;
    let down = 0;
    for (let i = end - spec.udvrBars + 1; i <= end; i++) {
      if (bars[i].close > bars[i - 1].close) up += bars[i].volume;
      else if (bars[i].close < bars[i - 1].close) down += bars[i].volume;
    }
    const ratio = down === 0 ? (up > 0 ? 99 : 0) : up / down;
    if (ratio >= spec.udvrHi) udvrPoints = 15;
    else if (ratio >= spec.udvrLo) udvrPoints = 8;
    udvrNote = `Up/down volume ${ratio.toFixed(2)}`;
  }

  let gapPoints = 0;
  let gapNote = "No held gap in the window";
  const gapStart = Math.max(1, end - spec.gapWindow + 1);
  for (let j = end; j >= gapStart; j--) {
    const prev = bars[j - 1].close;
    const priorAvg = avg(volumes, j - 1, 50);
    if (prev <= 0 || priorAvg == null) continue;
    const gap = (bars[j].open - prev) / prev;
    if (gap >= spec.gapPct && bars[j].volume >= spec.gapVolMultiple * priorAvg && close > bars[j].low) {
      gapPoints = 5;
      gapNote = `Held gap on ${bars[j].date}`;
      break;
    }
  }

  let character = 0;
  const characterNotes: string[] = [];
  if (high != null && close >= (1 - spec.characterHighRoom) * high) {
    character += 5;
    characterNotes.push("close is near the high");
  }
  const sma20 = smaAt(closes, end, 20);
  if (sma20 != null && end >= 19) {
    let low20 = Infinity;
    for (let i = end - 19; i <= end; i++) low20 = Math.min(low20, bars[i].low);
    if (low20 >= spec.characterSmaBuffer * sma20) {
      character += 5;
      characterNotes.push("20-bar low is holding the 20 SMA");
    }
  }

  const volumeBreak =
    smaFast != null &&
    avgVolume != null &&
    close < smaFast &&
    bar.volume >= spec.volumeBreakMultiple * avgVolume;

  return {
    symbol,
    date: bar.date,
    close,
    gates,
    passed: gates.every((gate) => gate.pass),
    volumeBreak,
    rsValue,
    themePercentile,
    themeName,
    points: [
      { key: "rs", label: "RS rank", points: 0, note: rsValue == null ? "RS needs 252 bars" : "Percentile pending" },
      { key: "rsLine", label: "RS line", points: rsLinePoints, note: rsLineNote },
      { key: "group", label: "Theme", points: groupPoints, note: groupNote },
      { key: "accumulation", label: "Accumulation", points: udvrPoints + gapPoints, note: `${udvrNote}. ${gapNote}` },
      { key: "fundamentals", label: "Fundamentals", points: 0, note: "Quarterly growth is not scored yet" },
      {
        key: "character",
        label: "Character",
        points: character,
        note: characterNotes.length ? characterNotes.join("; ") : "Not tight to the high or the 20 SMA",
      },
    ],
  };
}

export function finalizeDay(raw: RawScore[], pool: Set<string>, spec: MarketLeadersSpec): ScoredSymbol[] {
  const poolRs = raw.filter((row) => pool.has(row.symbol) && row.rsValue != null).map((row) => row.rsValue as number);
  return raw.map((row) => {
    const points = row.points.map((line) => ({ ...line }));
    let rsPercentile: number | null = null;
    if (row.rsValue != null && poolRs.length > 0) {
      const below = poolRs.filter((value) => value < (row.rsValue as number)).length;
      const denom = Math.max(1, poolRs.length - (pool.has(row.symbol) ? 1 : 0));
      rsPercentile = (below / denom) * 100;
      const rsLine = points.find((line) => line.key === "rs");
      if (rsLine) {
        rsLine.points = rsPercentile >= spec.rsTop ? 25 : rsPercentile >= spec.rsMid ? 18 : rsPercentile >= spec.rsLow ? 10 : 0;
        rsLine.note = `Percentile ${rsPercentile.toFixed(0)}`;
      }
    }
    const score = points.reduce((sum, line) => sum + line.points, 0);
    return { ...row, points, score, rsPercentile };
  });
}

interface Membership {
  on: boolean;
  joinDate: string | null;
  failStreak: number;
  leaveDate: string | null;
  leaveReason: string | null;
  days: number;
}

function blankMembership(): Membership {
  return { on: false, joinDate: null, failStreak: 0, leaveDate: null, leaveReason: null, days: 0 };
}

function rowFrom(score: ScoredSymbol, state: Membership, status: LeaderStatus, spec: MarketLeadersSpec): LeaderRow {
  const atRisk =
    status === "on" &&
    (score.score < spec.atRiskScore ||
      state.failStreak >= 1 ||
      (score.themePercentile != null && score.themePercentile > spec.groupTop));
  return {
    symbol: score.symbol,
    score: score.score,
    status: atRisk ? "at_risk" : status,
    leaveReason: status === "left" ? state.leaveReason : null,
    joinedOn: state.joinDate,
    leftOn: status === "left" ? state.leaveDate : null,
    daysOnBook: status === "left" ? 0 : state.days,
    gates: score.gates,
    points: score.points,
    themeName: score.themeName,
    close: score.close,
  };
}

export function walkBook(
  days: { date: string; scores: ScoredSymbol[] }[],
  spec: MarketLeadersSpec,
  reportFrom: string | null,
  reportTo: string,
): WalkResult {
  const state = new Map<string, Membership>();
  const lastScore = new Map<string, ScoredSymbol>();
  const spanDays = new Map<string, number>();
  const spanJoined = new Map<string, string>();
  const spanLeft = new Map<string, { date: string; why: string }>();
  const endIdx = days.reduce((found, day, index) => (day.date <= reportTo ? index : found), -1);
  const recent = new Set(days.slice(Math.max(0, endIdx - 4), endIdx + 1).map((day) => day.date));

  for (const day of days) {
    if (day.date > reportTo) break;
    const inReport = reportFrom == null ? day.date === reportTo : day.date >= reportFrom && day.date <= reportTo;
    for (const score of day.scores) {
      lastScore.set(score.symbol, score);
      const current = state.get(score.symbol) ?? blankMembership();
      if (!current.on) {
        if (score.passed && score.score >= spec.joinScore) {
          current.on = true;
          current.joinDate = day.date;
          current.failStreak = 0;
          current.leaveDate = null;
          current.leaveReason = null;
          current.days = 1;
        }
      } else {
        current.days += 1;
        let drop: string | null = null;
        if (score.volumeBreak) drop = "50 SMA break on volume";
        else {
          if (score.passed) current.failStreak = 0;
          else current.failStreak += 1;
          if (current.failStreak >= spec.gateFailCloses) drop = `Gate failed ${spec.gateFailCloses} closes`;
          else if (score.score < spec.stayScore) drop = "Score under stay";
        }
        if (drop) {
          current.on = false;
          current.leaveDate = day.date;
          current.leaveReason = drop;
          current.days = 0;
          current.failStreak = 0;
          if (inReport) spanLeft.set(score.symbol, { date: day.date, why: drop });
        }
      }
      state.set(score.symbol, current);
      if (inReport && current.on) {
        spanDays.set(score.symbol, (spanDays.get(score.symbol) ?? 0) + 1);
        if (!spanJoined.has(score.symbol) && current.joinDate) spanJoined.set(score.symbol, current.joinDate);
        if (current.leaveDate == null) spanLeft.delete(score.symbol);
      }
    }
  }

  const finalDay = [...days].reverse().find((day) => day.date <= reportTo);
  const finalBySymbol = new Map((finalDay?.scores ?? []).map((score) => [score.symbol, score]));
  const rows: LeaderRow[] = [];
  const left: LeaderRow[] = [];

  for (const [symbol, current] of state) {
    const score = finalBySymbol.get(symbol) ?? lastScore.get(symbol);
    if (!score) continue;
    if (current.on) rows.push(rowFrom(score, current, "on", spec));
    else if (current.leaveDate && recent.has(current.leaveDate)) left.push(rowFrom(score, current, "left", spec));
  }

  const span: SpanRow[] = [];
  for (const [symbol, daysInBook] of spanDays) {
    if (daysInBook <= 0) continue;
    const current = state.get(symbol);
    const score = finalBySymbol.get(symbol) ?? lastScore.get(symbol);
    const leftInfo = current?.on ? null : spanLeft.get(symbol) ?? null;
    span.push({
      symbol,
      daysInBook,
      joined: spanJoined.get(symbol) ?? current?.joinDate ?? null,
      left: leftInfo?.date ?? null,
      why: leftInfo?.why ?? null,
      score: score?.score ?? 0,
      status: current?.on ? (rows.find((row) => row.symbol === symbol)?.status ?? "on") : "left",
      themeName: score?.themeName ?? null,
    });
  }

  const onBook = rows.length;
  const atRisk = rows.filter((row) => row.status === "at_risk").length;
  const joinedThisWeek = rows.filter((row) => row.joinedOn != null && recent.has(row.joinedOn)).length;
  return {
    rows: rows.sort((a, b) => b.score - a.score),
    left: left.sort((a, b) => (b.leftOn ?? "").localeCompare(a.leftOn ?? "")),
    span: span.sort((a, b) => b.daysInBook - a.daysInBook || b.score - a.score),
    counts: { onBook, atRisk, joinedThisWeek, droppedThisWeek: left.length },
  };
}
