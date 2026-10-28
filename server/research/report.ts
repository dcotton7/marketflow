import type { Candidate } from "./analyze-symbol";
import type { Decision } from "./portfolio";
import type { RegimeRow } from "./regime";
import { ENTRY_SETUPS } from "./setups";
import { cellStats, MIN_SAMPLE, type CellStats, type EquityStats } from "./stats";
import type { StrategyPackage } from "./strategy";
import { packageHash } from "./strategy";

export interface VersionResult {
  version: StrategyPackage;
  decisions: Decision[];
  equity: EquityStats;
  audit: HardRuleAudit;
}

export interface HardRuleAudit {
  taken: number;
  worstLossPct: number;
  overMaxLoss: number;
  overMaxLossGaps: number;
  trims: number;
  trimsNotIntoStrength: number;
  tradesWithTrims: number;
  trimmedPastCap: number;
  stopTooWide: number;
  waitedFills: number;
  waitExpired: number;
  stopsWithoutLogicalBasis: number;
}

export interface ReportInput {
  title: string;
  tradeStart: string;
  tradeEnd: string;
  warmupStart: string;
  universeLabel: string;
  universeSize: number;
  symbolsWithBars: number;
  candidates: Candidate[];
  results: VersionResult[];
  regimes: Map<string, RegimeRow>;
  benchmarks: Record<string, { totalReturn: number; maxDd: number } | null>;
  gaps: string[];
  warnings: string[];
  fingerprint: string;
}

const pct = (v: number | null | undefined, dp = 1) => (v == null ? "–" : `${(v * 100).toFixed(dp)}%`);
const num = (v: number | null | undefined, dp = 2) => (v == null ? "–" : v.toFixed(dp));

function table(headers: string[], rows: (string | number)[][]): string {
  if (!rows.length) return "_none_\n";
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n") + "\n";
}

function statCells(s: CellStats): string[] {
  const flag = s.tooFew ? "too few to judge" : "";
  return [String(s.n), pct(s.winRate, 0), num(s.avgR), pct(s.expectancyPct, 2), num(s.maxDdR, 1), s.ci95 ? `${num(s.ci95[0])}…${num(s.ci95[1])}` : "–", flag];
}
const STAT_HEAD = ["trades", "win", "avg R", "exp %", "max DD (R)", "95% CI (R)", ""];

interface Row {
  c: Candidate;
  d: Decision;
  R: number;
  pct: number;
  exitDate: string;
  regime: RegimeRow | undefined;
}

function group(rows: Row[], key: (r: Row) => string): [string, Row[]][] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const l = m.get(k) ?? [];
    l.push(r);
    m.set(k, l);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

const setupLabel = (id: string) => ENTRY_SETUPS.find((s) => s.id === id)?.label ?? id;
const setupOrder = (id: string) => ENTRY_SETUPS.findIndex((s) => s.id === id);
const spyTrend = (r: Row) => (r.regime?.spy.above200 == null ? "SPY 200: ?" : r.regime.spy.above200 ? "SPY > 200SMA" : "SPY < 200SMA");

function crossTable(rows: Row[], colKey: (r: Row) => string, title: string): string {
  const out: (string | number)[][] = [];
  const bySetup = group(rows, (r) => r.c.setupId).sort((a, b) => setupOrder(a[0]) - setupOrder(b[0]));
  for (const [sid, list] of bySetup)
    for (const [col, cell] of group(list, colKey)) out.push([setupLabel(sid), col, ...statCells(cellStats(cell.map(toStat)))]);
  return `#### ${title}\n\n` + table(["setup", "cell", ...STAT_HEAD], out);
}

const toStat = (r: Row) => ({ R: r.R, pct: r.pct, exitDate: r.exitDate });

export function renderReport(x: ReportInput): string {
  const byId = new Map(x.candidates.map((c) => [c.id, c]));
  const L: string[] = [];
  L.push(`# ${x.title}`, "");
  L.push(`Trade window ${x.tradeStart} to ${x.tradeEnd} (warm-up bars from ${x.warmupStart}; no trade opens before ${x.tradeStart}). Universe: ${x.universeLabel}, ${x.universeSize} names, ${x.symbolsWithBars} with bars. Holdout year 2023 is locked and untouched. Run fingerprint \`${x.fingerprint}\`.`, "");
  L.push("**This pilot verifies the machinery. About ten months is one regime and too few trades per setup to judge setups or exits; nothing here is promoted.**", "");
  if (x.warnings.length) L.push("Warnings:", ...x.warnings.map((w) => `- ${w}`), "");
  if (x.gaps.length) L.push("Data gaps:", ...x.gaps.map((g) => `- ${g}`), "");
  L.push(`Benchmarks (buy and hold, price only, dividends not added): ${Object.entries(x.benchmarks).map(([k, v]) => `${k} ${v ? `${pct(v.totalReturn)} (max DD ${pct(v.maxDd)})` : "n/a"}`).join(", ")}.`, "");

  L.push("## Versions", "");
  L.push(
    table(
      ["version", "hash", "trades", "win", "avg R", "exp %", "PF", "total return", "max DD", "DD sessions", "exposure", "Sharpe"],
      x.results.map((r) => {
        const s = cellStats(rowsFor(r, byId, x.regimes).map(toStat));
        return [r.version.id, packageHash(r.version), s.n, pct(s.winRate, 0), num(s.avgR), pct(s.expectancyPct, 2), num(s.profitFactor), pct(r.equity.totalReturn), pct(r.equity.maxDd), r.equity.maxDdSessions, pct(r.equity.exposure, 0), num(r.equity.sharpe)];
      }),
    ),
  );
  L.push(x.results.map((r) => `- \`${r.version.id}\`: ${r.version.changeNote}`).join("\n"), "");

  L.push("## Hard rules audit", "");
  L.push(
    table(
      ["version", "taken", "worst loss", "losses > 5% (gaps)", "trims", "trims not into strength", "trades trimmed past cap", "stop too wide (skipped)", "waited then filled", "wait expired", "stops without a logical basis"],
      x.results.map((r) => {
        const a = r.audit;
        return [r.version.id, a.taken, pct(a.worstLossPct, 2), `${a.overMaxLoss} (${a.overMaxLossGaps})`, a.trims, a.trimsNotIntoStrength, a.trimmedPastCap, a.stopTooWide, a.waitedFills, a.waitExpired, a.stopsWithoutLogicalBasis];
      }),
    ),
  );
  L.push("Losses over 5% can only come from a gap through the stop (filled at the open) plus slippage; they are counted separately.", "");

  L.push("## Candidates by setup (all versions see the same candidates)", "");
  const tooWideBySetup = new Map<string, number>();
  if (x.results[0])
    for (const d of x.results[0].decisions) {
      const c = byId.get(d.candidateId)!;
      if (c.sims[d.simKey]?.status === "skipped_stop_too_wide") tooWideBySetup.set(c.setupId, (tooWideBySetup.get(c.setupId) ?? 0) + 1);
    }
  L.push(
    table(
      ["setup", "source", "candidates", "logical stop over 5% (first version)", "median stop % (signal close)", "median stop ATR"],
      group(x.candidates.map((c) => ({ c } as Row)), (r) => r.c.setupId)
        .sort((a, b) => setupOrder(a[0]) - setupOrder(b[0]))
        .map(([sid, list]) => {
          const ps = list.map((r) => r.c.stop.distPctAtSignalClose).sort((a, b) => a - b);
          const as = list.map((r) => r.c.stop.distAtr ?? NaN).filter(Number.isFinite).sort((a, b) => a - b);
          return [setupLabel(sid), list[0].c.source, list.length, tooWideBySetup.get(sid) ?? 0, pct(ps[Math.floor(ps.length / 2)]), num(as[Math.floor(as.length / 2)])];
        }),
    ),
  );
  for (const r of x.results) {
    const rows = rowsFor(r, byId, x.regimes);
    L.push(`## ${r.version.id}`, "");
    L.push(`Cells under ${MIN_SAMPLE} trades are marked "too few to judge".`, "");
    L.push("#### By setup", "");
    L.push(
      table(
        ["setup", ...STAT_HEAD],
        group(rows, (q) => q.c.setupId)
          .sort((a, b) => setupOrder(a[0]) - setupOrder(b[0]))
          .map(([sid, list]) => [setupLabel(sid), ...statCells(cellStats(list.map(toStat)))]),
      ),
    );
    L.push(crossTable(rows, (q) => q.c.stage ?? "?", "Setup × sub-stage at entry"));
    L.push(crossTable(rows, spyTrend, "Setup × SPY trend"));
    L.push(crossTable(rows, (q) => `VIX ${q.regime?.vixBucket ?? "?"}`, "Setup × VIX bucket"));
    L.push(crossTable(rows, (q) => `breadth ${q.regime?.breadthBucket ?? "?"}`, "Setup × breadth (share of S&P members above 50 SMA)"));
    L.push(crossTable(rows, (q) => `${q.c.stage ?? "?"} / ${spyTrend(q)}`, "Setup × sub-stage × SPY trend"));

    const exits: (string | number)[][] = [];
    for (const [reason, list] of group(rows, (q) => q.c.sims[q.d.simKey].exitReason ?? "?")) {
      const s = cellStats(list.map(toStat));
      const stages = group(list, (q) => q.c.sims[q.d.simKey].stageAtExit ?? "?").map(([k, l]) => `${k}:${l.length}`).join(" ");
      exits.push([reason, s.n, num(s.avgR), stages]);
    }
    L.push("#### Exits", "", table(["exit reason", "trades", "avg R", "sub-stage at exit"], exits));

    let trimR = 0;
    let trailR = 0;
    let both = 0;
    let only7 = 0;
    let onlyEx = 0;
    for (const q of rows) {
      const t = q.c.sims[q.d.simKey];
      trimR += t.trimR;
      trailR += t.trailR;
      for (const due of t.trimDues) {
        if (due.reason === "ext7+exhaustion") both++;
        else if (due.reason === "ext7") only7++;
        else onlyEx++;
      }
    }
    L.push(`Profit split: trims ${num(trimR, 1)}R, trailing piece and stops ${num(trailR, 1)}R. Trim triggers on held trades: 7× extension only ${only7}, Exhaustion Extension only ${onlyEx}, both on the same close ${both}.`, "");

    const would = x.candidates.filter((c) => r.decisions.some((d) => d.candidateId === c.id));
    const wRows: (string | number)[][] = [];
    const decById = new Map(r.decisions.map((d) => [d.candidateId, d]));
    for (const [sid, list] of group(would.map((c) => ({ c, d: decById.get(c.id)! } as Row)), (q) => q.c.setupId).sort((a, b) => setupOrder(a[0]) - setupOrder(b[0]))) {
      const skipped = list.filter((q) => q.d.decision === "skipped" && q.d.wouldHaveR != null);
      const s = cellStats(skipped.map((q) => ({ R: q.d.wouldHaveR as number, pct: 0, exitDate: q.c.signalDate })));
      const reasons = group(list.filter((q) => q.d.decision === "skipped"), (q) => q.d.reason.split(":")[0]).map(([k, l]) => `${k} ${l.length}`).join("; ");
      wRows.push([setupLabel(sid), list.length, list.filter((q) => q.d.decision === "taken").length, s.n, num(s.avgR), reasons]);
    }
    L.push("#### Skipped candidates and what they would have done", "", table(["setup", "candidates", "taken", "skipped with outcome", "would-have avg R", "skip reasons"], wRows));
  }
  return L.join("\n");
}

export function rowsFor(r: VersionResult, byId: Map<string, Candidate>, regimes: Map<string, RegimeRow>): Row[] {
  return r.decisions
    .filter((d) => d.decision === "taken" && d.R != null)
    .map((d) => {
      const c = byId.get(d.candidateId)!;
      const t = c.sims[d.simKey];
      return { c, d, R: d.R as number, pct: t.pctReturn ?? 0, exitDate: t.exitDate ?? c.signalDate, regime: regimes.get(c.regimeId ?? "") };
    });
}
