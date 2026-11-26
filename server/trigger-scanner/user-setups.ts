/**
 * User-defined setups, stored as data per account (trigger_user_setups) and evaluated with the BigIdea indicator
 * library (server/bigidea/indicators.ts INDICATOR_LIBRARY), the same conditions the BigIdea scanner's Thoughts use:
 * a list of { indicatorId, params: [{ name, value }], inverted, muted }, all of which must pass (AND).
 *
 * What is built now (small and safe): DAILY timeframe only. Before the open each active user setup is evaluated on
 * every universe name's finished daily bars; a pass puts the name on that user's watch list with an entry level from
 * the setup's entry rule (prev_high, prev_low, prev_close), and the `daily_in_range` trigger raises it intraday on the
 * same 5-minute bars as the built-ins. The candidate carries setup_owner "user:<id>" and is served to that account
 * only. Intraday criteria (ITD-*), weekly bars and an intraday "becomes true on this bar" condition are not built
 * yet (docs/trigger-scanner.md, "User setups: the plan").
 */
import { INDICATOR_LIBRARY, normalizeResult, type CandleData } from "../bigidea/indicators";
import type { UserSetupRow } from "./store";
import type { DailyWatch } from "./triggers/common";
import type { DailyBar, DailyContext } from "./types";

export const USER_SETUP_KEY = /^[a-z][a-z0-9_]{2,39}$/;
/**
 * Indicators a stored setup may not use here: the two the BigIdea review measured as too slow for 1,700 names (CB-1
 * 13.8 s, PA-17 40 s, docs/reviews in Anitir) and the ones that need intraday bars or fundamentals the daily load
 * does not have. The ITD-* ones are also wrong today (ITD-1 measures the wrong range, ITD-2 is not session VWAP).
 */
export const BLOCKED_INDICATORS = new Set(["CB-1", "PA-17", "MA-10"]);
/** A user setup that takes longer than this (all names, one day) is switched off for the day and says so. */
export const USER_SETUP_BUDGET_MS = 3000;

/**
 * The criteria of the owner's own BigIdea idea (scanner_ideas: { user_id, nodes, edges }), when it is exactly ONE
 * daily thought wired to Results. More than one thought is refused on purpose: the BigIdea scan's optimizer chains
 * thoughts and changes OR results (review 3.2), and this evaluator stays a plain AND of one thought's criteria.
 */
export function criteriaFromIdea(idea: { user_id: number; nodes: any[]; edges?: any[] } | undefined, owner: number): { criteria: any[] } | { error: string } {
  if (!idea) return { error: "idea not found" };
  if (Number(idea.user_id) !== owner) return { error: "idea belongs to another account" };
  const thoughts = (idea.nodes ?? []).filter((n: any) => n?.type === "thought" && !n.isMuted);
  if (thoughts.length !== 1) return { error: `idea has ${thoughts.length} thoughts (one daily thought only for now)` };
  const t = thoughts[0];
  if (t.isNot) return { error: "a NOT thought is not supported" };
  if ((t.thoughtTimeframe ?? "daily") !== "daily") return { error: `thought timeframe ${t.thoughtTimeframe} (daily only for now)` };
  if (!Array.isArray(t.thoughtCriteria) || !t.thoughtCriteria.length) return { error: "thought has no criteria" };
  return { criteria: t.thoughtCriteria };
}
const ENTRY_RULES = ["prev_high", "prev_low", "prev_close"] as const;

/** Why a stored setup cannot run, or null when it can. */
export function validateUserSetup(u: UserSetupRow, limits: { userSetupMaxCriteria: number }): string | null {
  if (!Number.isInteger(u.ownerUserId) || u.ownerUserId <= 0) return "owner";
  if (!USER_SETUP_KEY.test(u.setupKey)) return "setup_key (a-z, 0-9, _; 3-40 characters)";
  if (u.side !== "long" && u.side !== "short") return "side";
  if (u.timeframe !== "daily") return "timeframe (daily only for now)";
  if (!ENTRY_RULES.includes(u.entryRule as any)) return "entry_rule (prev_high, prev_low or prev_close)";
  if (u.rangeAdr !== null && !(u.rangeAdr > 0 && u.rangeAdr <= 3)) return "range_adr (0-3)";
  if (!Array.isArray(u.criteria) || u.criteria.length === 0) return "criteria (at least one)";
  const active = u.criteria.filter((c) => !c?.muted);
  if (active.length === 0) return "criteria (all muted)";
  if (u.criteria.length > limits.userSetupMaxCriteria) return `criteria (at most ${limits.userSetupMaxCriteria})`;
  for (const c of active) {
    const ind = INDICATOR_LIBRARY.find((x) => x.id === c?.indicatorId);
    if (!ind) return `unknown indicator ${String(c?.indicatorId)}`;
    if (BLOCKED_INDICATORS.has(ind.id)) return `${ind.id} is not allowed in a scanner setup (too slow or needs intraday bars)`;
    if (ind.category === "Intraday") return `${ind.id} is intraday (daily setups only for now)`;
    if (ind.category === "Fundamental") return `${ind.id} needs fundamentals the scanner does not load`;
    if (c.timeframeOverride) return "timeframeOverride (not supported)";
  }
  return null;
}

/** The criterion's parameter values: the library's defaults, then the stored values by name. */
function paramValues(c: any): Record<string, any> {
  const ind = INDICATOR_LIBRARY.find((x) => x.id === c.indicatorId)!;
  const v: Record<string, any> = {};
  for (const p of ind.params) v[p.name] = p.defaultValue;
  for (const p of c.params ?? []) if (p && typeof p.name === "string") v[p.name] = p.value;
  return v;
}

/** All active criteria pass on these finished daily bars (oldest first in, newest first for the library). */
export function userSetupPasses(u: UserSetupRow, bars: DailyBar[]): boolean {
  const candles: CandleData[] = [...bars].reverse().map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  for (const c of u.criteria) {
    if (c?.muted) continue;
    const ind = INDICATOR_LIBRARY.find((x) => x.id === c.indicatorId);
    if (!ind) return false;
    let pass: boolean;
    try {
      pass = normalizeResult(ind.evaluate(candles, paramValues(c))).pass;
    } catch {
      return false;
    }
    if (c.inverted) pass = !pass;
    if (!pass) return false;
  }
  return true;
}

export function userWatch(u: UserSetupRow, ctx: DailyContext): DailyWatch {
  const entryLevel = u.entryRule === "prev_high" ? ctx.prevHigh : u.entryRule === "prev_low" ? ctx.prevLow : ctx.prevClose;
  return { setupKey: u.setupKey, setupOwner: `user:${u.ownerUserId}`, ownerUserId: u.ownerUserId, side: u.side, entryName: u.entryRule, entryLevel, hitDate: ctx.asOf, tested: false, rangeAdr: u.rangeAdr };
}

/** Keep at most `max` setups per account (the newest keys first by version order given). */
export function capPerAccount(rows: UserSetupRow[], max: number): { kept: UserSetupRow[]; dropped: UserSetupRow[] } {
  const per = new Map<number, number>();
  const kept: UserSetupRow[] = [], dropped: UserSetupRow[] = [];
  for (const r of rows) {
    const n = per.get(r.ownerUserId) ?? 0;
    if (n >= max) dropped.push(r);
    else { kept.push(r); per.set(r.ownerUserId, n + 1); }
  }
  return { kept, dropped };
}
