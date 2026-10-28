import { createHash } from "node:crypto";
import { classifyCycle, cycleMeasures, type CycleParams } from "./cycle";
import { computeFacts, type IndexCloses, type SymbolFacts } from "./facts";
import type { ExitPolicy, VixBucket } from "./exit-policy";
import type { RegimeRow } from "./regime";
import { evaluateRules, type RuleName, type RuleThresholds } from "./rules";
import { ENTRY_SETUPS, SIGNAL_SETUPS } from "./setups";
import type { EntryOrder, EntrySetup, LogicalStop, SignalDetails } from "./setups/types";
import type { StrategyPackage } from "./strategy";
import { simulateTrade, type TradeResult, type TradeSignals } from "./trade";
import type { CheckResult, DailyBar, MinuteBar, SubStage, WeinsteinStage } from "./types";
import { weinsteinStages } from "./weinstein";
import { round } from "./setups/helpers";

/**
 * Everything the backtest decides for one symbol, from its bars and point-in-time cross-sectional inputs (RS rank,
 * regime). Pure: no I/O, so the lookahead test can run it on altered futures.
 */

export interface SimKey {
  key: string;
  policy: ExitPolicy;
  waitSessions: number;
  enforceMaxLoss: boolean;
}

export interface AnalyzeContext {
  symbol: string;
  index: IndexCloses;
  /** Signals are evaluated for bars dated on/after this (the session before the trade window start). */
  signalFrom: string;
  /** Last date a trade may be opened (fills after it are ignored). */
  tradeEnd: string;
  versions: StrategyPackage[];
  rsRankAt: (date: string) => number | null;
  regimeAt: (date: string) => RegimeRow | undefined;
  vixBucketAt: (date: string) => VixBucket;
  slippageBps: (dollarVol20: number | null) => number;
  minute?: (date: string) => MinuteBar[] | null;
  wantMinutes: boolean;
  /** Same setup on the same symbol is not logged again within this many sessions. */
  cooldownSessions: number;
}

export interface Candidate {
  id: string;
  symbol: string;
  setupId: string;
  setupParamsHash: string;
  source: "kell" | "library";
  counterTrend: boolean;
  signalDate: string;
  signalIndex: number;
  order: EntryOrder;
  stop: LogicalStop & { distPctAtSignalClose: number; distAtr: number | null };
  details: SignalDetails;
  stage: SubStage | null;
  weinsteinStage: WeinsteinStage | null;
  cycle: Record<string, number | string | boolean | null> | null;
  facts: Record<string, number | null>;
  rsRank: number | null;
  regimeId: string | null;
  /** Rule results per thresholds hash (versions share them unless thresholds differ). */
  checks: Record<string, Record<RuleName, CheckResult>>;
  /** Trade simulation per exit/entry policy key. */
  sims: Record<string, TradeResult & { stageAtExit: SubStage | null; regimeAtExit: string | null; fillDate: string | null; exitDate: string | null }>;
}

export function simKeysFor(versions: StrategyPackage[]): SimKey[] {
  const out = new Map<string, SimKey>();
  for (const v of versions) {
    for (const enforce of [true, false]) {
      const key = hashOf({ p: v.exitPolicy, w: enforce ? v.params.waitSessions : 0, e: enforce });
      if (!out.has(key)) out.set(key, { key, policy: v.exitPolicy, waitSessions: enforce ? v.params.waitSessions : 0, enforceMaxLoss: enforce });
    }
  }
  return [...out.values()];
}

export function hashOf(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 10);
}

export function thresholdsKey(t: RuleThresholds): string {
  return hashOf(t);
}

function setupVariants(versions: StrategyPackage[]) {
  const out = new Map<string, { setup: EntrySetup; params: any; paramsHash: string }>();
  for (const v of versions) {
    for (const s of v.setups) {
      const setup = ENTRY_SETUPS.find((x) => x.id === s.id);
      if (!setup) throw new Error(`Version ${v.id} enables unknown setup ${s.id}`);
      const params = { ...setup.defaults, ...(s.params ?? {}) };
      const paramsHash = hashOf(params);
      out.set(`${s.id}:${paramsHash}`, { setup, params, paramsHash });
    }
  }
  return [...out.values()].sort((a, b) => ENTRY_SETUPS.indexOf(a.setup) - ENTRY_SETUPS.indexOf(b.setup));
}

export function factsSnapshot(f: SymbolFacts, i: number): Record<string, number | null> {
  const close = f.bars[i].close;
  const atr = f.atr14[i];
  const pick: [string, (number | null)[]][] = [
    ["sma5", f.sma5], ["sma10", f.sma10], ["sma20", f.sma20], ["sma50", f.sma50], ["sma150", f.sma150], ["sma200", f.sma200],
    ["ema10", f.ema10], ["ema20", f.ema20], ["atr14", f.atr14], ["rsi14", f.rsi14], ["macdHist", f.macdHist], ["relVol", f.relVol],
    ["dollarVol20", f.dollarVol20], ["distFrom52High", f.distFrom52High], ["ret63", f.ret63], ["ret126", f.ret126],
    ["extSma5", f.extSma5], ["extSma10", f.extSma10], ["extSma20", f.extSma20], ["extSma50", f.extSma50],
    ["rsVsSpy63", f.rsVsSpy63], ["rsVsSpy126", f.rsVsSpy126], ["rsVsQqq63", f.rsVsQqq63], ["rsLineDistFrom52High", f.rsLineDistFrom52High], ["mansfield", f.mansfield],
  ];
  const out: Record<string, number | null> = { close, atrPct: atr != null ? atr / close : null };
  for (const [k, s] of pick) out[k] = s[i] ?? null;
  for (const k of Object.keys(out)) out[k] = round(out[k], k === "dollarVol20" ? 0 : 4);
  return out;
}

export interface SymbolAnalysis {
  facts: SymbolFacts;
  stages: (SubStage | null)[];
  candidates: Candidate[];
  minuteNeeds: string[];
  missingFacts: string[];
}

export function analyzeSymbol(bars: DailyBar[], ctx: AnalyzeContext): SymbolAnalysis {
  const f = computeFacts(bars, ctx.index);
  const cycleParams: CycleParams = ctx.versions[0].cycle.params;
  const stages = classifyCycle(f, cycleParams);
  const wein = weinsteinStages(bars);
  const n = bars.length;
  const first = bars.findIndex((b) => b.date >= ctx.signalFrom);
  const missingFacts: string[] = [];
  if (first < 0) return { facts: f, stages, candidates: [], minuteNeeds: [], missingFacts };
  for (const [k, s] of [["sma200", f.sma200], ["high52", f.high52], ["mansfield", f.mansfield], ["cycle", stages]] as const)
    if (s[first] == null) missingFacts.push(k);

  const signalStart = Math.max(2, first - 40);
  const sig: TradeSignals = { exhaustion: new Array(n).fill(false), wedgeDrop: new Array(n).fill(false), bearishBnb: new Array(n).fill(false) };
  const lastAvoid: { index: number | null; id: string | null }[] = new Array(n).fill(null).map(() => ({ index: null, id: null }));
  let lastIdx: number | null = null;
  let lastId: string | null = null;
  for (let i = signalStart; i < n; i++) {
    for (const s of SIGNAL_SETUPS) {
      if (s.allowedStages && (stages[i] == null || !s.allowedStages.includes(stages[i] as SubStage))) continue;
      if (!s.detect({ f, i, stages }, s.defaults)) continue;
      if (s.id === "kell_exhaustion_extension") sig.exhaustion[i] = true;
      if (s.id === "kell_wedge_drop") sig.wedgeDrop[i] = true;
      if (s.id === "kell_bearish_base_n_break") sig.bearishBnb[i] = true;
      if (s.kind === "exit" || s.kind === "avoid") {
        lastIdx = i;
        lastId = s.id;
      }
    }
    lastAvoid[i] = { index: lastIdx, id: lastId };
  }

  const minPrice = Math.min(...ctx.versions.map((v) => v.rules.thresholds.priceMin));
  const minDv = Math.min(...ctx.versions.map((v) => v.rules.thresholds.dollarVolumeMin));
  const thresholdSets = new Map(ctx.versions.map((v) => [thresholdsKey(v.rules.thresholds), v.rules.thresholds]));
  const variants = setupVariants(ctx.versions);
  const simKeys = simKeysFor(ctx.versions);
  const lastFired = new Map<string, number>();
  const candidates: Candidate[] = [];
  const minuteNeeds = new Set<string>();

  for (let i = Math.max(first, 2); i < n; i++) {
    const b = bars[i];
    if (b.date > ctx.tradeEnd) break;
    const dv = f.dollarVol20[i];
    if (b.close < minPrice || dv == null || dv < minDv) continue;
    for (const v of variants) {
      const vk = `${v.setup.id}:${v.paramsHash}`;
      const prev = lastFired.get(vk);
      if (prev != null && i - prev <= ctx.cooldownSessions) continue;
      const signal = v.setup.detect({ f, i, stages }, v.params);
      if (!signal) continue;
      lastFired.set(vk, i);
      const atr = f.atr14[i];
      const regime = ctx.regimeAt(b.date);
      const rsRank = ctx.rsRankAt(b.date);
      const checks: Candidate["checks"] = {};
      for (const [tk, t] of thresholdSets)
        checks[tk] = evaluateRules(
          { f, i, stage: stages[i], allowedStages: v.setup.allowedStages, rsRank, regime, lastAvoidIndex: lastAvoid[i].index, lastAvoidId: lastAvoid[i].id },
          t,
        );
      const m = cycleMeasures(f, i);
      const cand: Candidate = {
        id: `${ctx.symbol}|${b.date}|${v.setup.id}`,
        symbol: ctx.symbol,
        setupId: v.setup.id,
        setupParamsHash: v.paramsHash,
        source: v.setup.source,
        counterTrend: !!v.setup.counterTrend,
        signalDate: b.date,
        signalIndex: i,
        order: signal.order,
        stop: {
          ...signal.stop,
          distPctAtSignalClose: round((b.close - signal.stop.price) / b.close, 4) as number,
          distAtr: atr ? round((b.close - signal.stop.price) / atr, 3) : null,
        },
        details: signal.details,
        stage: stages[i],
        weinsteinStage: wein[i],
        cycle: m ? Object.fromEntries(Object.entries(m).map(([k, x]) => [k, typeof x === "number" ? round(x, 3) : x])) : null,
        facts: factsSnapshot(f, i),
        rsRank,
        regimeId: regime?.date ?? null,
        checks,
        sims: {},
      };
      for (const sk of simKeys) {
        const r = simulateTrade({
          f,
          signalIndex: i,
          order: signal.order,
          stop: signal.stop,
          slipBps: ctx.slippageBps(dv),
          policy: sk.policy,
          waitSessions: sk.waitSessions,
          signals: sig,
          vixBucketAt: ctx.vixBucketAt,
          minute: ctx.minute,
          wantMinutes: ctx.wantMinutes,
          enforceMaxLoss: sk.enforceMaxLoss,
        });
        if (r.fillIndex != null && bars[r.fillIndex].date > ctx.tradeEnd && r.status === "filled") continue;
        for (const d of r.minuteNeeds) minuteNeeds.add(d);
        cand.sims[sk.key] = {
          ...r,
          fillDate: r.fillIndex != null ? bars[r.fillIndex].date : null,
          exitDate: r.exitIndex != null ? bars[r.exitIndex].date : null,
          stageAtExit: r.exitIndex != null ? stages[r.exitIndex] : null,
          regimeAtExit: r.exitIndex != null ? (ctx.regimeAt(bars[r.exitIndex].date)?.date ?? null) : null,
        };
      }
      candidates.push(cand);
    }
  }
  return { facts: f, stages, candidates, minuteNeeds: [...minuteNeeds].sort(), missingFacts };
}
