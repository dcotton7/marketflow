import type { Candidate } from "./analyze-symbol";
import { hashOf, thresholdsKey } from "./analyze-symbol";
import { ENTRY_SETUPS } from "./setups";
import type { StrategyPackage } from "./strategy";
import type { TradeResult } from "./trade";

/**
 * Applies one strategy version to the candidate list: required rule checks, the version's trade simulation, then
 * portfolio limits and sizing in date order. shares = floor(equity × account risk ÷ (entry − stop)), capped by the
 * maximum position size and cash. Exits at the open free their slot before that day's fills; intraday stops after.
 */

export type DecisionKind = "taken" | "skipped";

export interface Decision {
  candidateId: string;
  version: string;
  decision: DecisionKind;
  reason: string;
  /** Failed required checks, in order. */
  failed: string[];
  simKey: string;
  wouldHaveSimKey: string | null;
  shares: number;
  entryDate: string | null;
  entry: number | null;
  stop: number;
  R: number | null;
  wouldHaveR: number | null;
}

export interface EquityPoint {
  date: string;
  equity: number;
  invested: number;
  positions: number;
}

const OPEN_EXITS = new Set(["stop_gap", "stop_breakeven_gap", "trail_sma5", "trail_sma10", "trail_sma20", "wedge_drop", "bearish_base_n_break"]);

export function simKeyForVersion(v: StrategyPackage, enforce = true): string {
  return hashOf({ p: v.exitPolicy, w: enforce ? v.params.waitSessions : 0, e: enforce });
}

function sim(c: Candidate, key: string): (TradeResult & { fillDate: string | null }) | undefined {
  return c.sims[key];
}

export function runPortfolio(
  version: StrategyPackage,
  candidates: Candidate[],
  calendar: string[],
  tradeStart: string,
  closeOf: (symbol: string, date: string) => number | null,
): { decisions: Decision[]; equity: EquityPoint[] } {
  const key = simKeyForVersion(version, true);
  const wideKey = simKeyForVersion(version, false);
  const tk = thresholdsKey(version.rules.thresholds);
  const enabled = new Set(version.setups.map((s) => `${s.id}:${hashOf({ ...ENTRY_SETUPS.find((x) => x.id === s.id)!.defaults, ...(s.params ?? {}) })}`));
  const order = new Map(ENTRY_SETUPS.map((s, i) => [s.id, i]));
  const decisions = new Map<string, Decision>();
  const toFill: Candidate[] = [];

  for (const c of candidates) {
    if (!enabled.has(`${c.setupId}:${c.setupParamsHash}`)) continue;
    const s = sim(c, key);
    const checks = c.checks[tk];
    const failed = version.rules.required.filter((r) => !checks[r].pass);
    const d: Decision = {
      candidateId: c.id,
      version: version.id,
      decision: "skipped",
      reason: "",
      failed,
      simKey: key,
      wouldHaveSimKey: null,
      shares: 0,
      entryDate: s?.fillDate ?? null,
      entry: s?.entry ?? null,
      stop: c.stop.price,
      R: null,
      wouldHaveR: s?.R ?? null,
    };
    if (!s) {
      d.reason = "fill after the trade window";
    } else if (failed.length) {
      const f0 = checks[failed[0]];
      d.reason = `failed ${f0.name}: ${f0.value ?? "missing"} vs ${f0.threshold}`;
    } else if (s.status !== "filled") {
      d.reason = s.status === "skipped_stop_too_wide" ? `stop too wide: ${s.note}` : `${s.status}: ${s.note}`;
    } else {
      toFill.push(c);
      d.reason = "pending";
    }
    if (s && (s.status === "skipped_stop_too_wide" || s.status === "wait_expired")) {
      const w = sim(c, wideKey);
      d.wouldHaveSimKey = wideKey;
      d.wouldHaveR = w?.R ?? null;
    }
    decisions.set(c.id, d);
  }

  const byDay = new Map<string, Candidate[]>();
  for (const c of toFill) {
    const fd = sim(c, key)!.fillDate as string;
    const list = byDay.get(fd) ?? [];
    list.push(c);
    byDay.set(fd, list);
  }
  for (const list of byDay.values())
    list.sort((a, b) => (b.rsRank ?? -1) - (a.rsRank ?? -1) || (order.get(a.setupId)! - order.get(b.setupId)!) || a.symbol.localeCompare(b.symbol));

  interface Pos {
    c: Candidate;
    t: TradeResult & { fillDate: string | null };
    shares: number;
    remaining: number;
    lastClose: number;
  }
  let cash = version.params.startingEquity;
  const open = new Map<string, Pos>();
  const equity: EquityPoint[] = [];
  const commission = version.params.costs.commissionPerTrade;
  let prevEquity = cash;

  const applyPieces = (pos: Pos, date: string, atOpen: boolean) => {
    for (const pc of pos.t.pieces) {
      if (pc.date !== date || OPEN_EXITS.has(pc.reason) !== atOpen || (pc.kind === "trim" && atOpen)) continue;
      cash += pos.shares * pc.fraction * pc.price - commission;
      pos.remaining -= pc.fraction;
    }
    if (pos.remaining <= 1e-9) open.delete(pos.c.symbol);
  };

  for (const date of calendar) {
    if (date < tradeStart) continue;
    for (const pos of [...open.values()]) applyPieces(pos, date, true);
    for (const c of byDay.get(date) ?? []) {
      const d = decisions.get(c.id)!;
      const t = sim(c, key)!;
      if (open.has(c.symbol)) {
        d.reason = "already holding this symbol";
        continue;
      }
      if (open.size >= version.params.maxPositions) {
        d.reason = `max positions (${version.params.maxPositions})`;
        continue;
      }
      const entry = t.entry as number;
      const riskPerShare = entry - c.stop.price;
      let shares = Math.floor((prevEquity * version.params.accountRiskPct) / riskPerShare);
      shares = Math.min(shares, Math.floor((prevEquity * version.params.maxPositionPct) / entry), Math.floor((cash - commission) / entry));
      if (shares < 1) {
        d.reason = "no cash for a position";
        continue;
      }
      cash -= shares * entry + commission;
      d.decision = "taken";
      d.reason = t.limitFill ? `taken on a limit within 5% of the stop (${t.waitedSessions} session(s) after the first fill day)` : "taken";
      d.shares = shares;
      d.R = t.R;
      const pos: Pos = { c, t, shares, remaining: 1, lastClose: entry };
      open.set(c.symbol, pos);
    }
    for (const pos of [...open.values()]) {
      if (pos.t.fillDate === date) {
        for (const pc of pos.t.pieces) if (pc.date === date) {
          cash += pos.shares * pc.fraction * pc.price - commission;
          pos.remaining -= pc.fraction;
        }
        if (pos.remaining <= 1e-9) open.delete(pos.c.symbol);
      } else applyPieces(pos, date, false);
    }
    let invested = 0;
    for (const pos of open.values()) {
      const px = closeOf(pos.c.symbol, date);
      if (px != null) pos.lastClose = px;
      invested += pos.shares * pos.remaining * pos.lastClose;
    }
    prevEquity = cash + invested;
    equity.push({ date, equity: prevEquity, invested, positions: open.size });
  }
  for (const d of decisions.values()) if (d.reason === "pending") d.reason = "fill after the trade window";
  return { decisions: [...decisions.values()], equity };
}
