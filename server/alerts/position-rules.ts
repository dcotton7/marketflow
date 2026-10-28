import { atrxFrom50, calculateSMA } from "@shared/chart-indicators";
import { exhaustionExtension, KELL, wedgeDrop } from "./kell";
import { brokenLevels } from "./levels";

/**
 * Don's position rules as signals (docs/specs/alerts-and-watchlists.md, phase 3). Pure: bars and prices in, signals
 * out. Signals feed the position snapshot; Anima's Quinn weighs them (a stop breach always alerts).
 *
 * - Stop: the position's planned (logical) stop, or the maxLossPct cap under entry when that is tighter; the cap is
 *   only the most he will lose, never a stop to suggest. Live price only. Warn within warnPctOfEntry of the stop (at
 *   −4% for the cap), breach at the stop.
 * - Level break: price under a logical level (levels.ts LEVELS.breakKinds) above the stop that held at yesterday's
 *   close.
 * - Trim: the chart's ATRx from 50MA ≥ trimAtr. Suggested trim % from VIX (vixTrimPct). Labelled Kell's
 *   Exhaustion Extension when that check also holds.
 * - Trail (daily close only): close below the trailing SMA. "Extended" is the chart's ATRx from 50MA, the same number
 *   as the trim rule: ≥ veryExtendedAtr → SMA5; profit ≥ bigProfitPct and ATRx < calmAtr → SMA20; otherwise SMA10.
 * - Wedge Drop (Kell, daily close only): "consider exiting"; nothing is done automatically.
 */
export const POSITION_RULES = {
  maxLossPct: 5,
  warnPctOfEntry: 1,
  trimAtr: 7,
  vixTrim: [
    { below: 15, pct: 5 },
    { below: 20, pct: 10 },
    { below: 25, pct: 15 },
    { below: 30, pct: 20 },
    { below: Infinity, pct: 25 },
  ],
  trail: { veryExtendedAtr: 5, bigProfitPct: 20, calmAtr: 3, fast: 5, mid: 10, slow: 20 },
  kell: KELL,
};
export type PositionRuleParams = typeof POSITION_RULES;

export type PositionSignalRule = "stop" | "level_break" | "trim" | "trail" | "wedge_drop";

export interface DayBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PositionInput {
  itemId: number;
  symbol: string;
  entry: number;
  stopPlan?: number | null;
  shares?: number | null;
}

export interface MarketInput {
  /** Daily bars oldest first; the last one is today's (live during the session). */
  bars: DayBar[];
  /** Live price, or null outside the session. */
  price: number | null;
  /** The last bar is today's finished regular session (after 16:00 ET). */
  closeFinal: boolean;
  vix: number | null;
  /** ET calendar day, YYYY-MM-DD. */
  day: string;
}

export interface PositionSignal {
  rule: PositionSignalRule;
  level: string;
  message: string;
  detail: Record<string, unknown>;
  /** Once per position, rule and level per ET day. */
  key: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

/** Today's bar at the live price, as the chart draws it. */
export function withLivePrice<T extends { high: number; low: number; close: number }>(bars: T[], price: number | null): T[] {
  if (price == null || !(price > 0) || !bars.length) return bars;
  const last = bars[bars.length - 1];
  return [...bars.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }];
}

export function vixTrimPct(vix: number | null, params: PositionRuleParams = POSITION_RULES): number | null {
  if (vix == null || !Number.isFinite(vix) || vix <= 0) return null;
  return params.vixTrim.find((step) => vix < step.below)?.pct ?? null;
}

export function stopFor(
  entry: number,
  stopPlan: number | null | undefined,
  params = POSITION_RULES,
): { stop: number; planned: boolean } {
  const hard = entry * (1 - params.maxLossPct / 100);
  const planned = stopPlan != null && Number.isFinite(stopPlan) && stopPlan > hard;
  return { stop: planned ? stopPlan! : hard, planned };
}

export function trailPeriod(extensionAtr: number | null, profitPct: number, params = POSITION_RULES): number {
  const t = params.trail;
  if (extensionAtr != null && extensionAtr >= t.veryExtendedAtr) return t.fast;
  if (profitPct >= t.bigProfitPct && extensionAtr != null && extensionAtr < t.calmAtr) return t.slow;
  return t.mid;
}

export function evaluatePosition(
  pos: PositionInput,
  mkt: MarketInput,
  params: PositionRuleParams = POSITION_RULES,
): PositionSignal[] {
  const out: PositionSignal[] = [];
  const bars = withLivePrice(mkt.bars, mkt.price);
  if (!(pos.entry > 0) || bars.length === 0) return out;
  const sym = pos.symbol.toUpperCase();
  const add = (rule: PositionSignalRule, level: string, message: string, detail: Record<string, unknown>) =>
    out.push({ rule, level, message, detail, key: `pos:${pos.itemId}:${rule}:${level}:${mkt.day}` });

  const live = mkt.price != null && mkt.price > 0 ? mkt.price : null;
  if (live != null) {
    const { stop, planned } = stopFor(pos.entry, pos.stopPlan, params);
    const warnAt = stop + (pos.entry * params.warnPctOfEntry) / 100;
    const fromEntry = ((live - pos.entry) / pos.entry) * 100;
    const what = planned ? `planned stop ${money(stop)}` : `${params.maxLossPct}% max-loss cap ${money(stop)}`;
    const detail = { price: r2(live), stop: r2(stop), warnAt: r2(warnAt), pctFromEntry: r2(fromEntry), planned };
    if (live <= stop) {
      add("stop", "breach", `${sym} hit the ${what}: ${money(live)}, ${fromEntry.toFixed(1)}% from entry ${money(pos.entry)}.`, detail);
    } else if (live <= warnAt) {
      add("stop", "warn", `${sym} is near the ${what}: ${money(live)}, ${fromEntry.toFixed(1)}% from entry ${money(pos.entry)}.`, detail);
    }
    if (live > stop) {
      for (const l of brokenLevels(bars, live, stop)) {
        add("level_break", l.kind,
          `${sym} broke below the ${l.label} (${money(l.price)}) at ${money(live)}; the stop is ${money(stop)}.`,
          { price: r2(live), level: l.price, kind: l.kind, label: l.label, stop: r2(stop) });
      }
    }

    const ext = atrxFrom50(live, bars);
    if (ext != null && ext >= params.trimAtr) {
      const pct = vixTrimPct(mkt.vix, params);
      const ex = exhaustionExtension(bars, live, params.kell.exhaustionExtension);
      const trimShares = pct != null && pos.shares ? Math.max(1, Math.floor((pos.shares * pct) / 100)) : null;
      const how = pct == null
        ? "VIX unavailable, so no trim size"
        : `VIX ${mkt.vix!.toFixed(1)} → trim ${pct}%` + (trimShares ? ` (${trimShares} of ${pos.shares} shares)` : "");
      add("trim", "trim",
        `${sym} is ${ext.toFixed(1)} ATRs above its 50-day SMA at ${money(live)}` +
          (ex ? ` (Exhaustion Extension: ${ex.detail.atrOverEma10} ATRs over the 10 EMA)` : "") + `. ${how}.`,
        { price: r2(live), extensionAtr: r2(ext), vix: mkt.vix, trimPct: pct, trimShares,
          setup: ex ? "exhaustion_extension" : null });
    }
  }

  if (mkt.closeFinal) {
    const close = bars[bars.length - 1].close;
    const ext = atrxFrom50(close, bars);
    const profitPct = ((close - pos.entry) / pos.entry) * 100;
    const period = trailPeriod(ext, profitPct, params);
    const ma = calculateSMA(bars, period)[bars.length - 1];
    if (ma != null && close < ma) {
      add("trail", `sma${period}`,
        `${sym} closed at ${money(close)}, below its ${period}-day SMA (${money(ma)}): trail stop. ` +
          `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(1)}% from entry, ${ext != null ? ext.toFixed(1) : "?"} ATRs from the 50-day.`,
        { close: r2(close), sma: r2(ma), period, extensionAtr: ext != null ? r2(ext) : null, profitPct: r2(profitPct) });
    }
    const wd = wedgeDrop(bars, true, params.kell.wedgeDrop);
    if (wd) {
      add("wedge_drop", "exit",
        `${sym} Wedge Drop: closed at ${money(close)} below the 10 EMA (${money(Number(wd.detail.ema10))}) and 20 EMA ` +
          `(${money(Number(wd.detail.ema20))}) after stalling. Consider exiting.`,
        { close: r2(close), ...wd.detail, setup: "wedge_drop", profitPct: r2(profitPct) });
    }
  }
  return out;
}
