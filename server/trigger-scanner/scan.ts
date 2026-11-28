/**
 * One scanner pass, pure: given the day's 5-minute bars per symbol, the daily contexts, the watch lists, the regime
 * and the rotation read, run every trigger on every bar not yet evaluated, apply the stop rule, grade, dedupe, and
 * return the candidates. The scheduler (scheduler.ts) and the replay tool (replay.ts) both call this; neither adds
 * any rule of its own.
 */
import { gradeCandidate } from "./grade";
import { dailyLevels, levelsAt, pickStop, rightSide } from "./levels";
import { setupInfo, TRIGGERS } from "./registry";
import { groupLeading } from "./rotation";
import { barCloseIso, buildSession, relVol } from "./session";
import { RULE_VERSION, type ScannerSettings } from "./settings";
import { candidateTrend } from "./trend";
import type { DailyWatch } from "./triggers/common";
import type { Bar, Candidate, DailyContext, Level, Regime, Rotation, Side, StopPick, TriggerHit } from "./types";

/** "Not again within the window" per (day, symbol, side, setup, owner, variant). Survives a restart via seed(). */
export class Dedupe {
  private last = new Map<string, number>();
  static base(c: { marketDate: string; symbol: string; side: string; setupKey: string; setupOwner: string; variant: string }): string {
    return [c.marketDate, c.symbol, c.side, c.setupKey, c.setupOwner, c.variant].join("|");
  }
  /** The last raise per (day, symbol, side), with its grade points, for the conflict rule. */
  private sides = new Map<string, { at: number; points: number }>();
  static sideKey(day: string, symbol: string, side: string): string {
    return [day, symbol, side].join("|");
  }
  /** True when this base has not fired inside the window (records nothing). */
  free(base: string, atMs: number, windowMin: number): boolean {
    const prev = this.last.get(base);
    return prev === undefined || atMs - prev >= windowMin * 60_000;
  }
  lastSide(day: string, symbol: string, side: string): { at: number; points: number } | undefined {
    return this.sides.get(Dedupe.sideKey(day, symbol, side));
  }
  markSide(day: string, symbol: string, side: string, atMs: number, points: number): void {
    const k = Dedupe.sideKey(day, symbol, side);
    const prev = this.sides.get(k);
    if (!prev || atMs >= prev.at) this.sides.set(k, { at: atMs, points });
  }
  /** True when this raise is new (and records it); false when the same base fired inside the window. */
  take(base: string, atMs: number, windowMin: number): boolean {
    const prev = this.last.get(base);
    if (prev !== undefined && atMs - prev < windowMin * 60_000) return false;
    this.last.set(base, atMs);
    return true;
  }
  /** After a restart, from a stored dedupe base (day|symbol|side|...). A seeded side has unknown points: a later
   *  opposite candidate inside the conflict window is refused. */
  seed(base: string, atMs: number): void {
    const prev = this.last.get(base);
    if (prev === undefined || atMs > prev) this.last.set(base, atMs);
    const [day, symbol, side] = base.split("|");
    if (day && symbol && side) this.markSide(day, symbol, side, atMs, Infinity);
  }
  clear(): void {
    this.last.clear();
    this.sides.clear();
  }
}

/** Weekday sessions from `from` to `to` (0 = same day); holidays are not subtracted (a slight overcount is safe). */
export function sessionsUntil(from: string, to: string): number {
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (end < d.getTime()) return -1;
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export interface Ready {
  h: TriggerHit;
  setupOwner: string;
  ownerUserId: number | null;
  base: string;
  window: number;
  levels: Level[];
  entry: number;
  stop: StopPick;
  company: string[];
  leading: boolean;
  rv: number | null;
  g: ReturnType<typeof gradeCandidate>;
}

/**
 * One bar's graded hits on one name, after the stop rule: what is raised (v3, docs "Noise rules").
 *   same bar, same side, several built-in intraday setups: one candidate, the most points (the first in registry order
 *     among equals); the others are named in facts.also and counted as <setup>:same_bar. A named setup (gap and go, a
 *     daily setup in range) takes them in instead and is never merged away; a user's own setup is left alone.
 *   same bar, both sides: the side ahead by conflictKeepPoints is kept, else neither (<setup>:conflict).
 *   a later bar, the other side raised (or refused as a conflict) on this name within conflictWindowMin: refused
 *     (<setup>:conflict) unless ahead of that one by conflictKeepPoints; the earlier one is already served and stands.
 * Every side that reaches the conflict rule is remembered, raised or not, so a name that keeps flipping stays out.
 */
export function settleBar(ready: Ready[], symbol: string, atMs: number, day: string, st: ScannerSettings, dedupe: Dedupe, refused: Record<string, number>): Ready[] {
  const bump = (k: string) => (refused[k] = (refused[k] ?? 0) + 1);
  // a named setup (gap and go, a daily setup in range) and a user's own are never merged away; a user's never absorbs
  const named = (r: Ready) => r.setupOwner === "builtin" && (r.h.setupKey.startsWith("gap_") || r.h.facts.hitDate !== undefined);
  const bySide: Partial<Record<Side, { kept: Ready[]; points: number }>> = {};
  for (const side of ["long", "short"] as Side[]) {
    const mine = ready.filter((r) => r.h.side === side);
    if (!mine.length) continue;
    const users = mine.filter((r) => r.setupOwner !== "builtin");
    const names = mine.filter(named);
    const generic = mine.filter((r) => r.setupOwner === "builtin" && !named(r));
    const most = (rs: Ready[]) => rs.reduce((a, r) => (r.g.points > a.g.points ? r : a));
    const into = names.length ? most(names) : generic.length ? most(generic) : null;
    const merged = generic.filter((r) => r !== into);
    for (const o of merged) { bump(`${o.h.setupKey}:same_bar`); dedupe.take(o.base, atMs, o.window); }
    if (into && merged.length) {
      const also = [typeof into.h.facts.also === "string" ? into.h.facts.also : null, ...merged.map((o) => o.h.setupKey)].filter(Boolean);
      into.h.facts = { ...into.h.facts, also: [...new Set(also)].join(",") };
    }
    const kept = [...(into ? [into] : []), ...names.filter((r) => r !== into), ...users];
    bySide[side] = { kept, points: Math.max(...kept.map((r) => r.g.points)) };
  }
  const keep = st.conflictKeepPoints;
  let sides = (["long", "short"] as Side[]).filter((x) => bySide[x]);
  if (sides.length === 2) {
    const d = bySide.long!.points - bySide.short!.points;
    const winner: Side | null = d >= keep ? "long" : -d >= keep ? "short" : null;
    for (const x of sides) if (x !== winner) for (const r of bySide[x]!.kept) bump(`${r.h.setupKey}:conflict`);
    sides = winner ? [winner] : [];
  }
  // the other side raised (or refused as a conflict) on an earlier bar inside the window: refused unless well ahead
  const out: Ready[] = [];
  for (const x of sides) {
    const other = dedupe.lastSide(day, symbol, x === "long" ? "short" : "long");
    const recent = st.conflictWindowMin > 0 && other && atMs - other.at < st.conflictWindowMin * 60_000 && bySide[x]!.points - other.points < keep;
    if (recent) { for (const r of bySide[x]!.kept) bump(`${r.h.setupKey}:conflict`); continue; }
    out.push(...bySide[x]!.kept);
  }
  for (const x of ["long", "short"] as Side[]) if (bySide[x]) dedupe.markSide(day, symbol, x, atMs, bySide[x]!.points);
  return out;
}

export interface PassInput {
  date: string;
  contexts: Map<string, DailyContext>;
  bars: Map<string, Bar[]>;
  watch: Map<string, DailyWatch[]>;
  regime: Regime;
  rotation: Rotation;
  settings: ScannerSettings;
  dedupe: Dedupe;
  /** Per symbol, the start time of the last bar already evaluated; updated in place. Empty = evaluate every bar. */
  evaluated: Map<string, number>;
  /** Only these symbols (the shortlist tier); all with bars when absent. */
  only?: Set<string>;
  earningsAsOf?: string | null;
}

export interface PassResult {
  candidates: Candidate[];
  symbolsScanned: number;
  barsEvaluated: number;
  triggers: number;
  deduped: number;
  refused: Record<string, number>;
  skipped: Record<string, number>;
  newestBar: string | null;
}

export function runPass(p: PassInput): PassResult {
  const out: PassResult = { candidates: [], symbolsScanned: 0, barsEvaluated: 0, triggers: 0, deduped: 0, refused: {}, skipped: {}, newestBar: null };
  const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  const st = p.settings;
  const spyTrend = p.contexts.get("SPY")?.trend ?? null;
  for (const [symbol, raw] of p.bars) {
    if (p.only && !p.only.has(symbol)) continue;
    const ctx = p.contexts.get(symbol);
    if (!ctx) { bump(out.skipped, "no_daily_context"); continue; }
    if (!raw.length) continue;
    if (!(ctx.adrPct >= st.minAdrPct)) { bump(out.skipped, "adr_under_min"); continue; }
    out.symbolsScanned++;
    const s = buildSession(p.date, raw, st.orMinutes);
    const done = p.evaluated.get(symbol) ?? -Infinity;
    for (let i = 0; i < s.bars.length; i++) {
      const bar = s.bars[i];
      const t = Date.parse(bar.t);
      if (t <= done) continue;
      out.barsEvaluated++;
      if (!out.newestBar || bar.t > out.newestBar) out.newestBar = bar.t;
      const triggerAt = barCloseIso(bar);
      const atMs = Date.parse(triggerAt);
      let hits = TRIGGERS.flatMap((mod) => mod.fn({ ctx, s, i, settings: st, watch: p.watch.get(symbol) }));
      // a setup that replaces another on the same bar and side (gap_and_go day 0 over orb_breakout): raise one, note both
      for (const h of hits.filter((x) => x.replaces)) {
        if (hits.some((x) => x.setupKey === h.replaces && x.side === h.side)) {
          hits = hits.filter((x) => !(x.setupKey === h.replaces && x.side === h.side));
          h.facts = { ...h.facts, also: h.replaces! };
        }
      }
      // each hit through the noise rules, the stop rule and the grade; dedupe is checked here and taken only for kept ones
      const ready: Ready[] = [];
      for (const h of hits) {
        out.triggers++;
        if (h.refused) { bump(out.refused, `${h.setupKey}:${h.refused}`); continue; }
        const setupOwner = typeof h.facts.setupOwner === "string" ? h.facts.setupOwner : "builtin";
        const ownerUserId = typeof h.facts.ownerUserId === "number" ? h.facts.ownerUserId : null;
        const info = setupInfo(h.setupKey, setupOwner);
        const base = Dedupe.base({ marketDate: p.date, symbol, side: h.side, setupKey: h.setupKey, setupOwner, variant: h.variant });
        const levels = levelsAt(ctx, s, i);
        const entry = bar.c;
        const stop = pickStop(h.side, entry, h.stopLevels ?? levels, ctx.adr, st);
        if (!stop.ok) { bump(out.refused, `${h.setupKey}:${stop.refused}`); continue; }
        if (stop.riskAdr! < st.minRiskAdr - 1e-9) { bump(out.refused, `${h.setupKey}:stop_inside_noise`); continue; }
        const window = info?.dedupeMin ?? 60;
        if (!p.dedupe.free(base, atMs, window)) { out.deduped++; continue; }
        const company: string[] = [...stop.company];
        if (h.companyIf && stop.level!.name === h.companyIf.level) company.push(h.companyIf.reason);
        const leading = groupLeading(p.rotation, ctx.capSize, ctx.sector);
        const earningsIn = !ctx.earningsKnown ? undefined : ctx.nextEarnings ? sessionsUntil(p.date, ctx.nextEarnings) : null;
        const kind = info?.kind === "user" ? "user" : info?.tested || h.facts.tested === 1 ? "tested" : "builtin";
        const rv = relVol(s, i, ctx.avgVol20);
        const g = gradeCandidate({
          side: h.side, riskPct: stop.riskPct!, riskAdr: stop.riskAdr!, hasCompany: company.length > 0,
          setupKind: kind, regime: p.regime, groupLeading: leading, dollarVol20: ctx.dollarVol20,
          earningsInSessions: earningsIn !== undefined && earningsIn !== null && earningsIn < 0 ? null : earningsIn,
          relVol: rv, levelName: typeof h.facts.levelName === "string" ? h.facts.levelName : stop.level!.name,
        }, st);
        ready.push({ h, setupOwner, ownerUserId, base, window, levels, entry, stop, company, leading, rv, g });
      }
      for (const r of settleBar(ready, symbol, atMs, p.date, st, p.dedupe, out.refused)) {
        const { h, setupOwner, ownerUserId, base, levels, entry, stop, company, leading, rv, g } = r;
        p.dedupe.take(base, atMs, r.window);
        const near = levels
          .filter((l) => rightSide(l, "long", entry) || rightSide(l, "short", entry))
          .map((l) => ({ name: l.name, price: round(l.price), role: (l.price < entry ? "support" : "resistance") as "support" | "resistance" }));
        out.candidates.push({
          marketDate: p.date,
          symbol,
          side: h.side,
          setupKey: h.setupKey,
          setupOwner,
          ownerUserId,
          variant: h.variant,
          why: h.why,
          triggerAt,
          bar,
          entryRef: entry,
          stopLevel: stop.level!.name,
          stopLevelPrice: round(stop.level!.price),
          stopPrice: round(stop.stop!),
          stopGap: stop.level!.gap ?? null,
          riskPct: round(stop.riskPct!),
          riskAdr: round(stop.riskAdr!),
          adrPct: round(ctx.adrPct),
          levels: near,
          relVolume: rv === null ? null : round(rv),
          liquidity: { price: ctx.prevClose, avgVol20: Math.round(ctx.avgVol20), dollarVol20: Math.round(ctx.dollarVol20), asOf: ctx.asOf },
          regime: p.regime,
          capSize: ctx.capSize,
          sector: ctx.sector,
          groupLeading: leading,
          rotation: { asOf: p.rotation.asOf, leadingSize: p.rotation.leadingSize, leadingSectors: p.rotation.leadingSectors },
          grade: g.grade,
          gradePoints: g.points,
          gradeComponents: g.components,
          dataAsOf: { bars: triggerAt, daily: ctx.asOf, regime: p.regime.asOf, rotation: p.rotation.asOf, earnings: ctx.earningsKnown ? p.earningsAsOf ?? null : null },
          facts: {
            ...h.facts,
            company: company.join(",") || null,
            // gap and go: the risk from the pivot itself to the stop (the entry Don has in mind)
            ...(typeof h.facts.pivot === "number" ? { risk_from_pivot_pct: round((Math.abs(Number(h.facts.pivot) - stop.stop!) / Number(h.facts.pivot)) * 100) } : {}),
            // and from the entry to the post-gap consolidation's low (a short: its high), the stop Don prefers
            ...(typeof h.facts.cons_low === "number" ? { risk_to_cons_low_pct: round((Math.abs(entry - Number(h.facts.cons_low)) / entry) * 100) } : {}),
          },
          dedupeKey: `${base}|${triggerAt}`,
          ruleVersion: RULE_VERSION,
          // measured beside the candidate, never used above: the grade, the stop and the pass rules do not see it
          trend: candidateTrend({ daily: ctx.trend, spy: spyTrend, side: h.side, entry, adr: ctx.adr, dailyLevels: dailyLevels(ctx), prevClose: ctx.prevClose, setupKey: h.setupKey, facts: h.facts }, st),
        });
      }
      p.evaluated.set(symbol, t);
    }
  }
  return out;
}

const round = (x: number) => Math.round(x * 10000) / 10000;
