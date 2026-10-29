import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import { analyzeSymbol, type AnalyzeContext, type Candidate } from "./analyze-symbol";
import { ensureDailyBars, lastCompletedSessionCutoff, readDailyBars, type DailyLoadReport } from "./data/daily-bars";
import { loadMacro } from "./data/macro";
import { loadMinuteBars, type MinuteFetchStats } from "./data/minute-bars";
import { RESEARCH_RESULTS_DIR } from "./data/paths";
import { buildUniverse, isSp500MemberOn, type UniverseMember } from "./data/universe";
import { HARD_RULES } from "./exit-policy";
import { computeFacts, type IndexCloses } from "./facts";
import { runPortfolio } from "./portfolio";
import { buildRegimes, type RegimeRow } from "./regime";
import { renderReport, type HardRuleAudit, type VersionResult } from "./report";
import { buyAndHold, equityStats } from "./stats";
import { packageHash, versionById, type StrategyPackage } from "./strategy";
import type { DailyBar, MinuteBar } from "./types";

/**
 * Backtest orchestration for Don's PC (never Render): loads and caches data, computes cross-sectional inputs (RS
 * rank, breadth, regimes), analyzes each symbol, applies each strategy version, and writes the decision log and
 * report to a local folder. No database access.
 */

export const HOLDOUT = { year: 2023, start: "2023-01-01", end: "2023-12-31", embargoSessions: 20 } as const;

export function assertOutsideHoldout(tradeStart: string, tradeEnd: string) {
  const pad = (d: string, days: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
  };
  const lockedFrom = pad(HOLDOUT.start, -40);
  const lockedTo = pad(HOLDOUT.end, 40);
  if (tradeStart <= lockedTo && tradeEnd >= lockedFrom)
    throw new Error(`Trade window ${tradeStart}..${tradeEnd} touches the locked ${HOLDOUT.year} holdout (with its ${HOLDOUT.embargoSessions}-session embargo).`);
}

export interface RunOptions {
  tradeStart: string;
  tradeEnd?: string;
  warmupStart: string;
  universe: "liquid" | "full";
  topN: number;
  rankDate: string;
  versions: string[];
  minute: boolean;
  label?: string;
  symbols?: string[];
  log?: (msg: string) => void;
}

function avgDollarVolume(bars: DailyBar[], asOf: string, window = 20): number | null {
  const upTo = bars.filter((b) => b.date <= asOf);
  if (upTo.length < window) return null;
  return upTo.slice(-window).reduce((a, b) => a + b.close * b.volume, 0) / window;
}

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export async function runBacktest(opts: RunOptions) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const t0 = Date.now();
  const cutoff = lastCompletedSessionCutoff();
  const tradeEnd = opts.tradeEnd && opts.tradeEnd < cutoff ? opts.tradeEnd : cutoff;
  assertOutsideHoldout(opts.tradeStart, tradeEnd);
  const versions: StrategyPackage[] = opts.versions.map(versionById);

  log(`[research] universe: loading lists`);
  const universe = await buildUniverse();
  const members: UniverseMember[] = opts.symbols
    ? opts.symbols.map((s) => universe.find((u) => u.symbol === s) ?? { symbol: s, sp500: false, sp500Added: null, nasdaq: false, delistedAddBack: false, name: "" })
    : universe;
  const all = [...new Set(["SPY", "QQQ", ...members.map((m) => m.symbol)])];

  log(`[research] daily bars: ${all.length} symbols ${opts.warmupStart}..${tradeEnd}`);
  let lastLog = 0;
  const dailyReport: DailyLoadReport = await ensureDailyBars(all, opts.warmupStart, tradeEnd, (done, total) => {
    if (Date.now() - lastLog > 5000 || done === total) {
      lastLog = Date.now();
      log(`[research]   ${done}/${total}`);
    }
  });
  log(`[research] daily bars: ${dailyReport.fromCache} cached, ${dailyReport.fetched} fetched, ${dailyReport.noData.length} without data, ${dailyReport.failed.length} failed`);

  // Every bar read stops at tradeEnd: the calendar, the equity curve, RS ranks and the trades all end with the window.
  const spyBars = readDailyBars("SPY", undefined, tradeEnd);
  const qqqBars = readDailyBars("QQQ", undefined, tradeEnd);
  if (spyBars.length < 250 || qqqBars.length < 250) throw new Error("SPY/QQQ bars missing; check Alpaca credentials (ALPACA_API_KEY / ALPACA_API_SECRET in .env)");
  const index: IndexCloses = { spy: new Map(spyBars.map((b) => [b.date, b.close])), qqq: new Map(qqqBars.map((b) => [b.date, b.close])) };
  const calendar = spyBars.map((b) => b.date);
  const ci = new Map(calendar.map((d, i) => [d, i]));

  let runMembers = members.filter((m) => m.symbol !== "SPY" && m.symbol !== "QQQ");
  if (opts.universe === "liquid" && !opts.symbols) {
    const ranked = runMembers
      .filter((m) => m.nasdaq || m.delistedAddBack || isSp500MemberOn(m, opts.rankDate))
      .map((m) => ({ m, adv: avgDollarVolume(readDailyBars(m.symbol, undefined, opts.rankDate), opts.rankDate) }))
      .filter((x) => x.adv != null)
      .sort((a, b) => (b.adv as number) - (a.adv as number) || a.m.symbol.localeCompare(b.m.symbol));
    runMembers = ranked.slice(0, opts.topN).map((x) => x.m);
  }
  const symbols = runMembers.map((m) => m.symbol).sort();
  log(`[research] run universe: ${symbols.length} symbols (${opts.universe})`);

  log(`[research] pass 1: RS ranks and breadth`);
  const T = calendar.length;
  const scores: Float64Array[] = [];
  const closes = new Map<string, Float64Array>();
  const breadthUp = new Float64Array(T);
  const breadthN = new Float64Array(T);
  for (const s of symbols) {
    const bars = readDailyBars(s, undefined, tradeEnd);
    const sc = new Float64Array(T).fill(NaN);
    const cl = new Float64Array(T).fill(NaN);
    const m = runMembers.find((x) => x.symbol === s)!;
    let sum50 = 0;
    for (let i = 0; i < bars.length; i++) {
      const k = ci.get(bars[i].date);
      sum50 += bars[i].close;
      if (i >= 50) sum50 -= bars[i - 50].close;
      if (k == null) continue;
      cl[k] = bars[i].close;
      if (i >= 126) sc[k] = 0.6 * (bars[i].close / bars[i - 63].close - 1) + 0.4 * (bars[i].close / bars[i - 126].close - 1);
      if (i >= 49 && isSp500MemberOn(m, bars[i].date)) {
        breadthN[k]++;
        if (bars[i].close > sum50 / 50) breadthUp[k]++;
      }
    }
    scores.push(sc);
    closes.set(s, cl);
  }
  const rank = new Map<string, Float32Array>(symbols.map((s) => [s, new Float32Array(T).fill(NaN)]));
  for (let k = 0; k < T; k++) {
    const live: { s: string; v: number }[] = [];
    symbols.forEach((s, j) => {
      const v = scores[j][k];
      if (Number.isFinite(v)) live.push({ s, v });
    });
    live.sort((a, b) => a.v - b.v);
    live.forEach((x, idx) => {
      rank.get(x.s)![k] = live.length > 1 ? (idx / (live.length - 1)) * 100 : 50;
    });
  }
  const breadth = new Map<string, number>();
  for (let k = 0; k < T; k++) if (breadthN[k] >= 20) breadth.set(calendar[k], breadthUp[k] / breadthN[k]);

  log(`[research] regimes: loading VIX, VIX3M, 10y, Fed target`);
  const macro = await loadMacro(Number(opts.warmupStart.slice(0, 4)), Number(tradeEnd.slice(0, 4)));
  const regimes: Map<string, RegimeRow> = buildRegimes(computeFacts(spyBars, index), computeFacts(qqqBars, index), macro, breadth);

  const prevSession = calendar.filter((d) => d < opts.tradeStart).pop() ?? opts.tradeStart;
  const ctxBase: Omit<AnalyzeContext, "symbol" | "rsRankAt"> = {
    index,
    signalFrom: prevSession,
    tradeEnd,
    closeAtEnd: tradeEnd < cutoff,
    versions,
    regimeAt: (d) => regimes.get(d),
    vixBucketAt: (d) => regimes.get(d)?.vixBucket ?? "unknown",
    slippageBps: (dv) => (dv != null && dv > versions[0].params.costs.liquidDollarVolume ? versions[0].params.costs.slippageBpsLiquid : versions[0].params.costs.slippageBpsThin),
    wantMinutes: opts.minute,
    cooldownSessions: 5,
  };

  log(`[research] pass 2: facts, cycle, setups, trades${opts.minute ? " (minute bars for trim days)" : ""}`);
  const minuteStats: MinuteFetchStats = { requested: 0, fromCache: 0, fetched: 0, failed: 0 };
  const candidates: Candidate[] = [];
  const missingFacts = new Map<string, number>();
  let unresolvedMinuteDays = 0;
  let done = 0;
  lastLog = 0;
  for (const s of symbols) {
    const bars = readDailyBars(s, undefined, tradeEnd);
    done++;
    if (bars.length < 60) continue;
    const r = rank.get(s)!;
    const ctx: AnalyzeContext = { ...ctxBase, symbol: s, rsRankAt: (d) => { const k = ci.get(d); return k == null || !Number.isFinite(r[k]) ? null : Math.round(r[k] * 100) / 100; } };
    let analysis = analyzeSymbol(bars, ctx);
    const minutes = new Map<string, MinuteBar[]>();
    for (let pass = 0; opts.minute && pass < 3; pass++) {
      const needs = analysis.minuteNeeds.filter((d) => !minutes.has(d));
      if (!needs.length) break;
      const got = await loadMinuteBars(needs.map((date) => ({ symbol: s, date })), minuteStats);
      if (!got.size) break;
      for (const [k, v] of got) minutes.set(k.split("|")[1], v);
      analysis = analyzeSymbol(bars, { ...ctx, minute: (d) => minutes.get(d) ?? null });
    }
    unresolvedMinuteDays += analysis.minuteNeeds.length;
    for (const k of analysis.missingFacts) missingFacts.set(k, (missingFacts.get(k) ?? 0) + 1);
    candidates.push(...analysis.candidates);
    if (Date.now() - lastLog > 5000 || done === symbols.length) {
      lastLog = Date.now();
      log(`[research]   ${done}/${symbols.length} symbols, ${candidates.length} candidates`);
    }
  }
  candidates.sort((a, b) => a.signalDate.localeCompare(b.signalDate) || a.symbol.localeCompare(b.symbol) || a.setupId.localeCompare(b.setupId));

  const closeOf = (sym: string, date: string) => {
    const k = ci.get(date);
    const v = k == null ? NaN : closes.get(sym)?.[k] ?? NaN;
    return Number.isFinite(v) ? v : null;
  };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const maxSlip = Math.max(versions[0].params.costs.slippageBpsLiquid, versions[0].params.costs.slippageBpsThin) / 10_000;
  const results: VersionResult[] = versions.map((v) => {
    const { decisions, equity } = runPortfolio(v, candidates, calendar, opts.tradeStart, closeOf);
    const audit: HardRuleAudit = { taken: 0, worstLossPct: 0, overMaxLoss: 0, overMaxLossGaps: 0, trims: 0, trimsNotIntoStrength: 0, tradesWithTrims: 0, trimmedPastCap: 0, stopTooWide: 0, waitedFills: 0, waitExpired: 0, stopsWithoutLogicalBasis: 0 };
    for (const d of decisions) {
      if (d.reason.startsWith("stop too wide")) audit.stopTooWide++;
      if (d.reason.startsWith("wait_expired")) audit.waitExpired++;
      if (d.decision !== "taken") continue;
      const c = byId.get(d.candidateId)!;
      const t = c.sims[d.simKey];
      audit.taken++;
      if (t.limitFill) audit.waitedFills++;
      if (!c.stop.basis || !Number.isFinite(c.stop.level) || !c.stop.reason) audit.stopsWithoutLogicalBasis++;
      const loss = t.worstLossPct ?? 0;
      audit.worstLossPct = Math.max(audit.worstLossPct, loss);
      if (loss > HARD_RULES.maxLossPct + maxSlip + 1e-6) {
        audit.overMaxLoss++;
        if (t.gapThroughStop) audit.overMaxLossGaps++;
      }
      const trims = t.pieces.filter((p) => p.kind === "trim");
      audit.trims += trims.length;
      if (trims.length) audit.tradesWithTrims++;
      for (const p of trims) if (p.priorHigh == null || p.price / (1 - maxSlip) <= p.priorHigh) audit.trimsNotIntoStrength++;
      if (trims.reduce((a, p) => a + p.fraction, 0) > v.exitPolicy.trimCap + 1e-9) audit.trimmedPastCap++;
    }
    return { version: v, decisions, equity: equityStats(equity, v.params.startingEquity), audit, curve: equity } as VersionResult & { curve: typeof equity };
  });

  const window = (bars: DailyBar[]) => bars.filter((b) => b.date >= opts.tradeStart && b.date <= tradeEnd);
  const benchmarks = { SPY: buyAndHold(window(spyBars)), QQQ: buyAndHold(window(qqqBars)) };

  const gaps = [...macro.gaps];
  if (dailyReport.noData.length) gaps.push(`${dailyReport.noData.length} universe symbols have no Alpaca bars in the window (delisted, renamed or not served)`);
  if (dailyReport.failed.length) gaps.push(`${dailyReport.failed.length} symbols failed to download (retry the run): ${dailyReport.failed.slice(0, 10).join(", ")}${dailyReport.failed.length > 10 ? "…" : ""}`);
  for (const [k, n] of missingFacts) gaps.push(`${n} symbols lack enough history for ${k} at the window start (reported missing, never guessed)`);
  if (opts.minute) gaps.push(`Minute bars: ${minuteStats.requested} symbol-days requested, ${minuteStats.fromCache} cached, ${minuteStats.fetched} fetched, ${minuteStats.failed} failed; ${unresolvedMinuteDays} trim days fell back to daily bars`);
  else gaps.push("Minute bars off: trims fill at max(open, prior high + $0.01), and a same-day trim and stop assume the stop came first");
  gaps.push("Fed stance and earnings dates are not point-in-time yet; `earnings_gap` is logged as unknown and not required");
  const warnings = [
    "Survivorship-biased universe: today's S&P 500 and Nasdaq lists; names delisted before today are missing except those in data/delisted-symbols.json that Alpaca still serves.",
    "S&P 500 membership uses each name's date added; names removed from the index before today are missing.",
    opts.universe === "liquid" ? `RS percentile is ranked within this ${symbols.length}-name slice, not the full universe.` : "RS percentile is ranked within the run universe.",
    "Bars are split-adjusted with today's split factors (prices before a later split are scaled; returns are unaffected).",
  ];

  const label = opts.label ?? `pilot-${opts.universe}-${opts.tradeStart}_${tradeEnd}`;
  const outDir = path.join(RESEARCH_RESULTS_DIR, label);
  fs.mkdirSync(outDir, { recursive: true });
  const candLines = candidates.map((c) =>
    JSON.stringify({ ...c, sims: Object.fromEntries(Object.entries(c.sims).map(([k, s]) => [k, { ...s, path: undefined, minuteNeeds: undefined }])) }),
  );
  fs.writeFileSync(path.join(outDir, "candidates.jsonl"), candLines.join("\n") + "\n");
  const decisionHashes: Record<string, string> = {};
  for (const r of results as (VersionResult & { curve: { date: string; equity: number; invested: number; positions: number }[] })[]) {
    const lines = r.decisions.map((d) => JSON.stringify(d));
    decisionHashes[r.version.id] = sha(lines.join("\n"));
    fs.writeFileSync(path.join(outDir, `decisions-${r.version.id}.jsonl`), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(outDir, `equity-${r.version.id}.csv`), ["date,equity,invested,positions", ...r.curve.map((p) => `${p.date},${p.equity.toFixed(2)},${p.invested.toFixed(2)},${p.positions}`)].join("\n") + "\n");
    const head = "symbol,setup,signal_date,fill_date,entry,stop,stop_basis,stop_reason,stop_pct,stop_atr,shares,exit_date,exit_reason,R,pct,mfe_R,mae_R,days,trims,stage_entry,stage_exit,weinstein_info,vix_bucket,spy_vs_200";
    const rows = r.decisions
      .filter((d) => d.decision === "taken")
      .map((d) => {
        const c = byId.get(d.candidateId)!;
        const t = c.sims[d.simKey];
        const g = regimes.get(c.regimeId ?? "");
        return [c.symbol, c.setupId, c.signalDate, t.fillDate, t.entry?.toFixed(4), c.stop.price.toFixed(4), c.stop.basis, `"${c.stop.reason}"`, t.stopDistPct?.toFixed(4), t.stopDistAtr?.toFixed(2), d.shares, t.exitDate, t.exitReason, t.R?.toFixed(3), t.pctReturn?.toFixed(4), t.mfeR?.toFixed(2), t.maeR?.toFixed(2), t.daysHeld, t.pieces.filter((p) => p.kind === "trim").length, c.stage, t.stageAtExit, c.weinsteinStage ?? "", g?.vixBucket ?? "", g?.spy.above200 == null ? "" : g.spy.above200 ? "above" : "below"].join(",");
      });
    fs.writeFileSync(path.join(outDir, `trades-${r.version.id}.csv`), [head, ...rows].join("\n") + "\n");
  }
  const windowRegimes = [...regimes.values()].filter((g) => g.date >= opts.tradeStart && g.date <= tradeEnd);
  fs.writeFileSync(path.join(outDir, "regimes.jsonl"), windowRegimes.map((g) => JSON.stringify(g)).join("\n") + "\n");
  const fingerprint = sha(sha(candLines.join("\n")) + JSON.stringify(decisionHashes));

  const report = renderReport({
    title: `Strategy research pilot: ${opts.universe === "liquid" ? `${symbols.length} most liquid names` : "full universe"}`,
    tradeStart: opts.tradeStart,
    tradeEnd,
    warmupStart: opts.warmupStart,
    universeLabel: opts.universe === "liquid" ? `top ${opts.topN} S&P 500 + Nasdaq common stocks by 20-day dollar volume on ${opts.rankDate}` : "S&P 500 + Nasdaq-listed common stocks, liquidity floor per date",
    universeSize: symbols.length,
    symbolsWithBars: symbols.filter((s) => readDailyBars(s).length > 0).length,
    candidates,
    results,
    regimes,
    benchmarks,
    gaps,
    warnings,
    fingerprint,
  });
  fs.writeFileSync(path.join(outDir, "report.md"), report);
  const regimeMissing = windowRegimes.filter((g) => g.vix == null || g.breadthPct50 == null || g.spy.above200 == null || g.dgs10 == null).length;
  fs.writeFileSync(
    path.join(outDir, "run.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        seconds: Math.round((Date.now() - t0) / 1000),
        options: { ...opts, log: undefined, tradeEnd },
        versions: versions.map((v) => ({ id: v.id, hash: packageHash(v), package: v })),
        holdout: HOLDOUT,
        universe: { size: symbols.length },
        dailyBars: { ...dailyReport, noData: dailyReport.noData.length, failed: dailyReport.failed },
        minuteBars: minuteStats,
        macroSources: macro.sources,
        regimeDaysWithMissingFields: regimeMissing,
        candidates: candidates.length,
        decisionHashes,
        fingerprint,
      },
      null,
      2,
    ),
  );
  log(`[research] done in ${Math.round((Date.now() - t0) / 1000)}s: ${candidates.length} candidates -> ${outDir}`);
  return { outDir, fingerprint, candidates: candidates.length, results, gaps, tradeEnd, symbols: symbols.length };
}