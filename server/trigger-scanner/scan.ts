/**
 * One scanner pass, pure: given the day's 5-minute bars per symbol, the daily contexts, the watch lists, the regime
 * and the rotation read, run every trigger on every bar not yet evaluated, apply the stop rule, grade, dedupe, and
 * return the candidates. The scheduler (scheduler.ts) and the replay tool (replay.ts) both call this; neither adds
 * any rule of its own.
 */
import { gradeCandidate } from "./grade";
import { levelsAt, pickStop, rightSide } from "./levels";
import { setupInfo, TRIGGERS } from "./registry";
import { groupLeading } from "./rotation";
import { barCloseIso, buildSession, relVol } from "./session";
import { RULE_VERSION, type ScannerSettings } from "./settings";
import type { DailyWatch } from "./triggers/common";
import type { Bar, Candidate, DailyContext, Regime, Rotation } from "./types";

/** "Not again within the window" per (day, symbol, side, setup, owner, variant). Survives a restart via seed(). */
export class Dedupe {
  private last = new Map<string, number>();
  static base(c: { marketDate: string; symbol: string; side: string; setupKey: string; setupOwner: string; variant: string }): string {
    return [c.marketDate, c.symbol, c.side, c.setupKey, c.setupOwner, c.variant].join("|");
  }
  /** True when this raise is new (and records it); false when the same base fired inside the window. */
  take(base: string, atMs: number, windowMin: number): boolean {
    const prev = this.last.get(base);
    if (prev !== undefined && atMs - prev < windowMin * 60_000) return false;
    this.last.set(base, atMs);
    return true;
  }
  seed(base: string, atMs: number): void {
    const prev = this.last.get(base);
    if (prev === undefined || atMs > prev) this.last.set(base, atMs);
  }
  clear(): void {
    this.last.clear();
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
  for (const [symbol, raw] of p.bars) {
    if (p.only && !p.only.has(symbol)) continue;
    const ctx = p.contexts.get(symbol);
    if (!ctx) { bump(out.skipped, "no_daily_context"); continue; }
    if (!raw.length) continue;
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
      {
        for (const h of hits) {
          out.triggers++;
          const setupOwner = typeof h.facts.setupOwner === "string" ? h.facts.setupOwner : "builtin";
          const ownerUserId = typeof h.facts.ownerUserId === "number" ? h.facts.ownerUserId : null;
          const info = setupInfo(h.setupKey, setupOwner);
          const base = Dedupe.base({ marketDate: p.date, symbol, side: h.side, setupKey: h.setupKey, setupOwner, variant: h.variant });
          const levels = levelsAt(ctx, s, i);
          const entry = bar.c;
          const stop = pickStop(h.side, entry, h.stopLevels ?? levels, ctx.adr, st);
          if (!stop.ok) { bump(out.refused, `${h.setupKey}:${stop.refused}`); continue; }
          if (!p.dedupe.take(base, atMs, info?.dedupeMin ?? 60)) { out.deduped++; continue; }
          const company: string[] = [...stop.company];
          if (h.companyIf && stop.level!.name === h.companyIf.level) company.push(h.companyIf.reason);
          const leading = groupLeading(p.rotation, ctx.capSize, ctx.sector);
          const earningsIn = !ctx.earningsKnown ? undefined : ctx.nextEarnings ? sessionsUntil(p.date, ctx.nextEarnings) : null;
          const kind = info?.kind === "user" ? "user" : info?.tested || h.facts.tested === 1 ? "tested" : "builtin";
          const g = gradeCandidate({
            side: h.side, riskPct: stop.riskPct!, riskAdr: stop.riskAdr!, hasCompany: company.length > 0,
            setupKind: kind, regime: p.regime, groupLeading: leading, dollarVol20: ctx.dollarVol20,
            earningsInSessions: earningsIn !== undefined && earningsIn !== null && earningsIn < 0 ? null : earningsIn,
          }, st);
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
            relVolume: (() => { const r = relVol(s, i, ctx.avgVol20); return r === null ? null : round(r); })(),
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
          });
        }
      }
      p.evaluated.set(symbol, t);
    }
  }
  return out;
}

const round = (x: number) => Math.round(x * 10000) / 10000;
