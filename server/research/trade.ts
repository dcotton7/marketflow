import type { SymbolFacts } from "./facts";
import type { MinuteBar } from "./types";
import type { EntryOrder, LogicalStop } from "./setups/types";
import { HARD_RULES, type ExitPolicy, type VixBucket } from "./exit-policy";

/**
 * One candidate traded in isolation, bar by bar, using only what was known at each moment:
 * - Entries fill when the trigger was knowable: next-open orders at the next session's open; buy stops on the first
 *   later session that trades through the stop price, at max(open, stop price). Slippage on every fill.
 * - The stop is the setup's logical stop. If it is more than 5% below the fill, the trade is skipped, or (variant,
 *   waitSessions > 0) a limit order waits for a price where that same stop is within 5%.
 * - Stops fill at the stop price, or at the open when price gaps through it.
 * - Trims become due at a close and fill only into strength on a later session: above the prior session's high.
 * - Trail and Kell exits are decided at a close and fill at the next open.
 * Daily bars can't order a trim and a stop on the same day; minute bars decide it when available, otherwise the
 * stop is assumed first.
 */

export interface TradeSignals {
  exhaustion: boolean[];
  wedgeDrop: boolean[];
  bearishBnb: boolean[];
}

export interface TradeInput {
  f: SymbolFacts;
  signalIndex: number;
  order: EntryOrder;
  stop: LogicalStop;
  slipBps: number;
  policy: ExitPolicy;
  waitSessions: number;
  signals: TradeSignals;
  vixBucketAt: (date: string) => VixBucket;
  minute?: (date: string) => MinuteBar[] | null;
  /** Ask for minute bars on trim-fill and trim/stop days (returned in minuteNeeds when missing). */
  wantMinutes: boolean;
  /** False only for "would have" outcomes of trades the 5% rule skipped; never for taken trades. */
  enforceMaxLoss?: boolean;
}

export interface Piece {
  index: number;
  date: string;
  kind: "trim" | "exit";
  price: number;
  fraction: number;
  reason: string;
  r: number;
  /** Trims: the prior session's high the fill had to trade above. */
  priorHigh?: number;
}

export type TradeStatus = "filled" | "no_fill" | "skipped_stop_too_wide" | "skipped_gap_below_stop" | "wait_expired";

export interface TradeResult {
  status: TradeStatus;
  note: string;
  /** Fill (or would-be fill for skips) price after slippage. */
  entry: number | null;
  fillIndex: number | null;
  stopPrice: number;
  stopDistPct: number | null;
  stopDistAtr: number | null;
  waitedSessions: number;
  /** Filled by the wait-for-a-tighter-entry limit order (possibly later on the first fill day). */
  limitFill: boolean;
  pieces: Piece[];
  exitIndex: number | null;
  exitReason: string | null;
  open: boolean;
  R: number | null;
  pctReturn: number | null;
  trimR: number;
  trailR: number;
  mfeR: number | null;
  maeR: number | null;
  daysHeld: number | null;
  /** Worst exit vs entry, as a loss fraction (positive = loss). */
  worstLossPct: number | null;
  gapThroughStop: boolean;
  trimDues: { index: number; reason: string }[];
  /** Remaining share of the position after each session's actions, for portfolio mark-to-market. */
  path: { index: number; close: number; remaining: number }[];
  minuteNeeds: string[];
  minuteDaysUsed: number;
}

function slipUp(px: number, bps: number) {
  return px * (1 + bps / 10_000);
}
function slipDown(px: number, bps: number) {
  return px * (1 - bps / 10_000);
}

function emptyResult(status: TradeStatus, note: string, stop: number, extra: Partial<TradeResult> = {}): TradeResult {
  return {
    status,
    note,
    entry: null,
    fillIndex: null,
    stopPrice: stop,
    stopDistPct: null,
    stopDistAtr: null,
    waitedSessions: 0,
    limitFill: false,
    pieces: [],
    exitIndex: null,
    exitReason: null,
    open: false,
    R: null,
    pctReturn: null,
    trimR: 0,
    trailR: 0,
    mfeR: null,
    maeR: null,
    daysHeld: null,
    worstLossPct: null,
    gapThroughStop: false,
    trimDues: [],
    path: [],
    minuteNeeds: [],
    minuteDaysUsed: 0,
    ...extra,
  };
}

export function simulateTrade(input: TradeInput): TradeResult {
  const { f, signalIndex: i, order, policy: p, slipBps } = input;
  const bars = f.bars;
  const n = bars.length;
  const stop0 = input.stop.price;
  const maxLoss = HARD_RULES.maxLossPct;

  let fillIdx = -1;
  let entryRaw = 0;
  if (order.type === "next_open") {
    if (i + 1 >= n) return emptyResult("no_fill", "no session after the signal yet", stop0);
    fillIdx = i + 1;
    entryRaw = bars[fillIdx].open;
  } else {
    for (let k = i + 1; k <= i + order.validSessions && k < n; k++) {
      if (bars[k].high >= order.price) {
        fillIdx = k;
        entryRaw = Math.max(bars[k].open, order.price);
        break;
      }
    }
    if (fillIdx < 0) return emptyResult("no_fill", `buy stop ${order.price.toFixed(2)} not traded`, stop0);
  }

  if (stop0 >= entryRaw) return emptyResult("skipped_gap_below_stop", "opened at or below the logical stop", stop0, { fillIndex: fillIdx });
  let entry = slipUp(entryRaw, slipBps);
  let dist = (entry - stop0) / entry;
  let waited = 0;
  let limitFill = false;
  if (dist > maxLoss && input.enforceMaxLoss !== false) {
    const wouldBe = { entry, fillIndex: fillIdx, stopDistPct: dist, stopDistAtr: f.atr14[i] ? (entry - stop0) / (f.atr14[i] as number) : null };
    if (input.waitSessions <= 0)
      return emptyResult("skipped_stop_too_wide", `logical stop ${(dist * 100).toFixed(1)}% below entry (max ${maxLoss * 100}%)`, stop0, wouldBe);
    const limit = stop0 / (1 - maxLoss) / (1 + slipBps / 10_000);
    let filled = -1;
    for (let k = fillIdx; k < fillIdx + input.waitSessions && k < n; k++) {
      if (k > fillIdx) {
        if (bars[k - 1].close < stop0) return emptyResult("wait_expired", "closed below the logical stop while waiting", stop0, wouldBe);
        if (bars[k].open <= stop0) return emptyResult("wait_expired", "gapped below the logical stop while waiting", stop0, wouldBe);
      }
      const open = k === fillIdx ? Infinity : bars[k].open;
      if (bars[k].low <= limit) {
        filled = k;
        entryRaw = Math.min(open, limit);
        break;
      }
    }
    if (filled < 0) return emptyResult("wait_expired", `no price within ${maxLoss * 100}% of the stop in ${input.waitSessions} sessions`, stop0, wouldBe);
    waited = filled - fillIdx;
    limitFill = true;
    fillIdx = filled;
    entry = slipUp(entryRaw, slipBps);
    dist = (entry - stop0) / entry;
  }

  const atrAtSignal = f.atr14[i];
  const res = emptyResult("filled", limitFill ? `limit fill ${waited} session(s) after the first fill day, at a price within 5% of the stop` : "", stop0, {
    entry,
    fillIndex: fillIdx,
    stopDistPct: dist,
    stopDistAtr: atrAtSignal ? (entry - stop0) / atrAtSignal : null,
    waitedSessions: waited,
    limitFill,
  });
  const rUnit = entry - stop0;
  let stop = stop0;
  let remaining = 1;
  let trimmed = 0;
  let pendingExit: string | null = null;
  let pendingTrim: { reason: string; size: number } | null = null;
  let arm7 = true;
  let armEx = true;
  let trailMa: 5 | 10 | 20 = 10;
  let trailCand: 5 | 10 | 20 | null = null;
  let trailCandCount = 0;
  let armed = !p.armTrailAfterCloseAbove;
  let mfe = 0;
  let mae = 0;
  const pieces = res.pieces;

  const exitAll = (k: number, price: number, reason: string) => {
    pieces.push({ index: k, date: bars[k].date, kind: "exit", price, fraction: remaining, reason, r: ((price - entry) / rUnit) * remaining });
    remaining = 0;
    res.exitIndex = k;
    res.exitReason = reason;
  };

  for (let k = fillIdx; k < n; k++) {
    const bar = bars[k];
    if (k > fillIdx) {
      if (bar.open <= stop) {
        res.gapThroughStop = true;
        exitAll(k, slipDown(bar.open, slipBps), stop > stop0 ? "stop_breakeven_gap" : "stop_gap");
      } else if (pendingExit) exitAll(k, slipDown(bar.open, slipBps), pendingExit);
      if (remaining === 0) {
        res.path.push({ index: k, close: bar.close, remaining: 0 });
        break;
      }
      const priorHigh = bars[k - 1].high;
      const trimFillable = pendingTrim != null && bar.high > priorHigh;
      const stopHit = bar.low <= stop;
      let trimFirst = !stopHit;
      let trimPrice = Math.max(bar.open, priorHigh + 0.01);
      if (trimFillable && input.wantMinutes) {
        const mins = input.minute?.(bar.date) ?? null;
        if (!mins) res.minuteNeeds.push(bar.date);
        else {
          res.minuteDaysUsed++;
          const t = mins.findIndex((m) => m.high > priorHigh);
          const s = mins.findIndex((m) => m.low <= stop);
          if (t >= 0) trimPrice = Math.max(mins[t].open, priorHigh + 0.01);
          if (stopHit) trimFirst = t >= 0 && (s < 0 || t < s);
        }
      }
      if (trimFillable && trimFirst && pendingTrim) {
        const size = Math.min(pendingTrim.size, p.trimCap - trimmed, remaining);
        if (size > 1e-9) {
          const px = slipDown(trimPrice, slipBps);
          pieces.push({ index: k, date: bar.date, kind: "trim", price: px, fraction: size, reason: pendingTrim.reason, r: ((px - entry) / rUnit) * size, priorHigh });
          trimmed += size;
          remaining -= size;
          if (p.breakEvenAfterFirstTrim) stop = Math.max(stop, entry);
        }
        pendingTrim = null;
      }
      if (stopHit) {
        exitAll(k, slipDown(stop, slipBps), stop > stop0 ? "stop_breakeven" : "stop");
        res.path.push({ index: k, close: bar.close, remaining: 0 });
        break;
      }
    } else if (bar.low <= stop) {
      mae = Math.max(mae, (entry - bar.low) / rUnit);
      exitAll(k, slipDown(stop, slipBps), "stop");
      res.path.push({ index: k, close: bar.close, remaining: 0 });
      break;
    }

    mfe = Math.max(mfe, (bar.high - entry) / rUnit);
    mae = Math.max(mae, (entry - bar.low) / rUnit);
    const close = bar.close;

    let desired: 5 | 10 | 20 = 10;
    if (p.style === "dynamic_trail") {
      const x10 = f.extSma10[k];
      const x20 = f.extSma20[k];
      const profitR = (close - entry) / rUnit;
      if (x10 != null && x10 >= p.xFar) desired = 5;
      else if (profitR >= p.pLargeR && x20 != null && x20 <= p.yModerate) desired = 20;
    }
    if (desired !== trailMa) {
      if (desired === trailCand) trailCandCount++;
      else {
        trailCand = desired;
        trailCandCount = 1;
      }
      if (trailCandCount >= p.hysteresis) {
        trailMa = desired;
        trailCand = null;
        trailCandCount = 0;
      }
    } else {
      trailCand = null;
      trailCandCount = 0;
    }
    const ma = (trailMa === 5 ? f.sma5 : trailMa === 10 ? f.sma10 : f.sma20)[k];
    pendingExit = null;
    if (ma != null) {
      if (close > ma) armed = true;
      if (armed && close < ma) pendingExit = `trail_sma${trailMa}`;
    }
    if (p.kell.bearishBaseNBreak && input.signals.bearishBnb[k]) pendingExit = "bearish_base_n_break";
    if (p.kell.wedgeDrop !== "off" && input.signals.wedgeDrop[k] && (p.kell.wedgeDrop === "whole" || trimmed > 0)) pendingExit = "wedge_drop";

    const ext50 = f.extSma50[k];
    const exNow = p.kell.exhaustionTrim !== "off" && input.signals.exhaustion[k];
    if (ext50 != null && ext50 < HARD_RULES.trimExtension) arm7 = true;
    if (!exNow) armEx = true;
    if (pendingTrim) {
      const still7 = ext50 != null && ext50 >= HARD_RULES.trimExtension;
      const stillEx = pendingTrim.reason.includes("exhaustion") && ((f.ext10[k] ?? 0) >= 3 || (f.ext20[k] ?? 0) >= 5);
      if (!still7 && !stillEx) pendingTrim = null;
    }
    const due7 = ext50 != null && ext50 >= HARD_RULES.trimExtension && arm7;
    const dueEx = exNow && armEx;
    if ((due7 || dueEx) && !pendingTrim && trimmed < p.trimCap - 1e-9) {
      const bucket = input.vixBucketAt(bar.date);
      let size = bucket === "unknown" ? p.unknownVixTrim : p.vixTrimTable[bucket];
      if (dueEx && !due7 && p.kell.exhaustionTrim === "double") size *= 2;
      const reason = due7 && dueEx ? "ext7+exhaustion" : due7 ? "ext7" : "exhaustion";
      pendingTrim = { reason, size };
      res.trimDues.push({ index: k, reason });
      if (due7) arm7 = false;
      if (dueEx) armEx = false;
    }
    res.path.push({ index: k, close, remaining });
  }

  const last = res.path.length ? res.path[res.path.length - 1] : null;
  if (remaining > 0 && last) {
    res.open = true;
    res.exitIndex = last.index;
    res.exitReason = "open";
  }
  const realizedR = pieces.reduce((a, x) => a + x.r, 0);
  const openR = remaining > 0 && last ? ((last.close - entry) / rUnit) * remaining : 0;
  res.R = realizedR + openR;
  res.pctReturn = (res.R * rUnit) / entry;
  res.trimR = pieces.filter((x) => x.kind === "trim").reduce((a, x) => a + x.r, 0);
  res.trailR = res.R - res.trimR;
  res.mfeR = mfe;
  res.maeR = mae;
  res.daysHeld = res.exitIndex != null ? res.exitIndex - fillIdx : null;
  const worst = pieces.reduce((w, x) => Math.max(w, (entry - x.price) / entry), -Infinity);
  res.worstLossPct = Number.isFinite(worst) ? worst : null;
  return res;
}
