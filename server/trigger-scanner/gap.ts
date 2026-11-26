/**
 * Gap and go (Don, 26 Nov: "We should add gap and GO, the GO can happen up to n-number of days after the gap up").
 * Long `gap_and_go`, short `gap_down_and_go`. Every number is a setting (settings.ts); defaults in brackets.
 *
 * THE GAP DAY (daily, precomputed before the open from the finished sessions; today's own gap is read intraday)
 *   open >= edge x (1 + gapMinPct%) [4%]  and  open - edge >= gapMinAdr [1.0] x the ADR of the 20 sessions before,
 *     where edge = the prior session's HIGH (a true gap) by default, or its close with gapFrom = "prior_close";
 *   day volume >= gapVolMult [2.0] x the average of the gapVolDays [50] sessions before (at least 20 needed);
 *   close in the upper half of the day's range (CLV >= 0.5, the definition server/setups/earnings-gap-up.ts uses)
 *     and above the edge;
 *   not a split cliff in the stored history (daily-math looksLikeSplit, the setups' own guard).
 *   For today (day 0) the volume test is the day's volume so far against its time-of-day norm, and the close tests
 *   use the bar just closed.
 *   earnings_gap (a fact, never a requirement): true when the gap session is a reaction session of a report (the
 *   calendar's bmo/dmh = that day, amc = the next; earnings/upcoming.ts reactionSessions) or within earningsWindow
 *   [1] sessions after one; false when the calendar is fresh and has none; "unknown" when it is not fresh.
 *   The short mirror: open below the prior LOW (or close) by the same amounts, close in the lower half and below it.
 *
 * STILL VALID: today is day d = sessions after the gap day (the gap day itself is day 0); d <= goMaxDays [10]; and
 *   the gap HELD: no session since closed below the edge (short: above). A close through it kills the setup for good
 *   (the gap failed and flipped to resistance). The newest valid gap per direction is the one watched.
 *
 * THE GO (on a 5-minute close): the first close today above the go level + goBreakAdr [0.05] ADR, with the bar's
 *   relative volume >= goRelVol [1.5]. Go level = the highest high from the gap day through yesterday (the gap-day
 *   high, or the consolidation high when a later day exceeded it). On day 0 the go level is the opening-range high,
 *   after the range; when orb_breakout would fire on the same bar only gap_and_go is raised (facts.also).
 *   Once per gap per day. A later fire needs a new, higher go level after a pullback of at least repeatPullbackAdr
 *   [1.0] ADR since the last fire, and at most goMaxFires [2] fires per gap.
 *
 * STOP: the nearest valid level (levels.ts: 0.25 ADR noise floor, 5% refusal) among: the consolidation low (the
 *   sessions after the gap day through yesterday, only when above the edge), VWAP, today's low, the 5- and 10-day
 *   SMA, and the gap edge. A stop at a TIGHT consolidation's low (range <= tightRangeAdr [1.5] ADR over at least
 *   tightMinDays [2] sessions) earns the "has company" grade point.
 */
import { looksLikeSplit } from "../setups/daily-math";
import { cumRelVol, relVol } from "./session";
import type { ScannerSettings } from "./settings";
import type { TriggerFn } from "./triggers/common";
import { r2 } from "./triggers/common";
import type { DailyBar, GapGo, Level, TriggerHit } from "./types";

export interface PriorFire { gapDate: string; marketDate: string; goLevel: number; side: "long" | "short" }

type GapSettings = Pick<ScannerSettings, "gapFrom" | "gapMinPct" | "gapMinAdr" | "gapVolMult" | "gapVolDays" | "goMaxDays" | "repeatPullbackAdr" | "goMaxFires" | "earningsWindow">;

const clv = (b: { high: number; low: number; close: number }) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);

/** ADR in dollars from the 20 sessions before index k (at the close of k-1). */
function adrBefore(b: DailyBar[], k: number): number {
  const w = b.slice(Math.max(0, k - 20), k);
  if (w.length < 10) return NaN;
  return (w.reduce((s, x) => s + (x.high / x.low - 1), 0) / w.length) * b[k - 1].close;
}

function avgVolBefore(b: DailyBar[], k: number, n: number): number {
  const w = b.slice(Math.max(0, k - n), k);
  return w.length >= 20 ? w.reduce((s, x) => s + x.volume, 0) / w.length : NaN;
}

export interface GapDay { dir: "up" | "down"; edge: number; gapPct: number; gapAdr: number; volMult: number; adr: number }

/** Is session k a gap day (up or down) by the rule? Returns its numbers, or null. */
export function gapDay(b: DailyBar[], k: number, s: GapSettings): GapDay | null {
  if (k < 1) return null;
  const day = b[k], prev = b[k - 1];
  const adr = adrBefore(b, k);
  const avgVol = avgVolBefore(b, k, s.gapVolDays);
  if (!(adr > 0) || !(avgVol > 0)) return null;
  if (looksLikeSplit(prev.close, day.open, day.close)) return null;
  const volMult = day.volume / avgVol;
  if (volMult < s.gapVolMult) return null;
  const upEdge = s.gapFrom === "prior_close" ? prev.close : prev.high;
  const dnEdge = s.gapFrom === "prior_close" ? prev.close : prev.low;
  if (day.open >= upEdge * (1 + s.gapMinPct / 100) && day.open - upEdge >= s.gapMinAdr * adr && clv(day) >= 0.5 && day.close > upEdge) {
    return { dir: "up", edge: upEdge, gapPct: (day.open / upEdge - 1) * 100, gapAdr: (day.open - upEdge) / adr, volMult, adr };
  }
  if (day.open <= dnEdge * (1 - s.gapMinPct / 100) && dnEdge - day.open >= s.gapMinAdr * adr && clv(day) <= 0.5 && day.close < dnEdge) {
    return { dir: "down", edge: dnEdge, gapPct: (1 - day.open / dnEdge) * 100, gapAdr: (dnEdge - day.open) / adr, volMult, adr };
  }
  return null;
}

/** Whether the gap session is an earnings reaction (or within `window` sessions after one). */
export function earningsGapFact(gapDate: string, sessions: string[], reactions: string[] | null, window: number): boolean | "unknown" {
  if (reactions === null) return "unknown";
  const gi = sessions.indexOf(gapDate);
  return reactions.some((r) => {
    if (r === gapDate) return true;
    const ri = sessions.indexOf(r);
    return gi >= 0 && ri >= 0 && gi - ri >= 0 && gi - ri <= window;
  });
}

/**
 * The live gap per direction from finished sessions (oldest first, today NOT included): the newest gap day within
 * goMaxDays that has held. One pass over the last goMaxDays + 1 sessions.
 */
export function precomputeGapGo(
  b: DailyBar[],
  s: GapSettings,
  opts: { adrNow: number; fires?: PriorFire[]; earningsReactions?: string[] | null } = { adrNow: NaN },
): { up: GapGo | null; down: GapGo | null } {
  const out: { up: GapGo | null; down: GapGo | null } = { up: null, down: null };
  const n = b.length;
  const sessions = b.map((x) => x.date);
  for (let k = n - 1; k >= Math.max(1, n - s.goMaxDays); k--) {
    const day = n - k; // today's day number
    const g = gapDay(b, k, s);
    if (!g || out[g.dir]) continue;
    const after = b.slice(k + 1);
    const up = g.dir === "up";
    if (after.some((x) => (up ? x.close < g.edge : x.close > g.edge))) continue; // failed: never again from this gap
    const since = b.slice(k); // gap day through yesterday
    const extremeIdx = since.reduce((best, x, j) => ((up ? x.high > since[best].high : x.low < since[best].low) ? j : best), 0);
    const goLevel = up ? since[extremeIdx].high : since[extremeIdx].low;
    // sessions AFTER the one that made the extreme (inside that session the order of high and low is unknown)
    const afterExtreme = since.slice(extremeIdx + 1);
    const worst = !afterExtreme.length ? goLevel : up ? Math.min(...afterExtreme.map((x) => x.low)) : Math.max(...afterExtreme.map((x) => x.high));
    const adr = opts.adrNow > 0 ? opts.adrNow : g.adr;
    const consLow = after.length ? Math.min(...after.map((x) => x.low)) : null;
    const consHigh = after.length ? Math.max(...after.map((x) => x.high)) : null;
    // the repeat rule, against this gap's earlier fires
    const fires = (opts.fires ?? []).filter((f) => f.gapDate === b[k].date && f.side === (up ? "long" : "short")).sort((x, y) => x.marketDate.localeCompare(y.marketDate));
    let repeatOk = true, repeatWhy: string | null = null;
    if (fires.length >= s.goMaxFires) { repeatOk = false; repeatWhy = `fired ${fires.length} times (max ${s.goMaxFires})`; }
    else if (fires.length) {
      const last = fires[fires.length - 1];
      const fromLast = b.filter((x) => x.date >= last.marketDate);
      const pi = fromLast.reduce((best, x, j) => ((up ? x.high > fromLast[best].high : x.low < fromLast[best].low) ? j : best), 0);
      const peak = fromLast.length ? (up ? fromLast[pi].high : fromLast[pi].low) : last.goLevel;
      const tail = fromLast.slice(pi + 1);
      const trough = tail.length ? (up ? Math.min(...tail.map((x) => x.low)) : Math.max(...tail.map((x) => x.high))) : peak;
      const pull = Math.abs(peak - trough) / adr;
      const higher = up ? goLevel > last.goLevel : goLevel < last.goLevel;
      if (!(pull >= s.repeatPullbackAdr) || !higher) { repeatOk = false; repeatWhy = `no ${s.repeatPullbackAdr} ADR pullback and new go level since the fire on ${last.marketDate} (pullback ${r2(pull)} ADR)`; }
    }
    out[g.dir] = {
      dir: g.dir, date: b[k].date, day, edge: g.edge, gapPct: g.gapPct, gapAdr: g.gapAdr, volMult: g.volMult,
      goLevel, goFrom: up ? (extremeIdx === 0 ? "gap_day_high" : "consolidation_high") : (extremeIdx === 0 ? "gap_day_low" : "consolidation_low"),
      consLow, consHigh, consDays: after.length,
      consRangeAdr: consLow !== null && consHigh !== null ? (consHigh - consLow) / adr : null,
      pullbackAdr: Math.abs(goLevel - worst) / adr,
      earningsGap: earningsGapFact(b[k].date, sessions, opts.earningsReactions ?? null, s.earningsWindow),
      fires: fires.length, repeatOk, repeatWhy,
    };
    if (out.up && out.down) break;
  }
  return out;
}

/** The trigger. Days 1..goMaxDays from the precomputed gap; day 0 from today's own open. */
export const gapAndGo: TriggerFn = ({ ctx, s, i, settings: st }) => {
  if (!(ctx.adr > 0)) return [];
  const b = s.bars[i];
  const rv = relVol(s, i, ctx.avgVol20);
  if (rv === null || rv < st.goRelVol) return [];
  const out: TriggerHit[] = [];
  const firstClose = (level: number, up: boolean) => {
    const thr = up ? level + st.goBreakAdr * ctx.adr : level - st.goBreakAdr * ctx.adr;
    const crossed = (c: number) => (up ? c >= thr : c <= thr);
    if (!crossed(b.c)) return false;
    for (let j = 0; j < i; j++) if (crossed(s.bars[j].c)) return false;
    return true;
  };
  for (const g of [ctx.gapGo.up, ctx.gapGo.down]) {
    if (!g || !g.repeatOk) continue;
    const up = g.dir === "up";
    if (!firstClose(g.goLevel, up)) continue;
    const tight = g.consRangeAdr !== null && g.consDays >= st.tightMinDays && g.consRangeAdr <= st.tightRangeAdr;
    out.push(hit(up, g.date, g.day, g.edge, g.goLevel, g.goFrom, ctx.sma5, ctx.sma10, s.vwap[i], up ? s.lod[i] : s.hod[i], up ? g.consLow : g.consHigh, tight, rv, {
      gapPct: r2(g.gapPct), gapAdr: r2(g.gapAdr), volMult: r2(g.volMult), pullbackAdr: r2(g.pullbackAdr),
      consRangeAdr: r2(g.consRangeAdr), consDays: g.consDays, earningsGap: String(g.earningsGap), fireNo: g.fires + 1,
    }));
  }
  // day 0: today's own gap, read from the open; the go level is the opening-range high
  const open = s.bars[0]?.o;
  if (open > 0 && s.orHigh !== null && s.orLow !== null && i >= s.orEnd) {
    const crv = cumRelVol(s, i, ctx.avgVol50 > 0 ? ctx.avgVol50 : ctx.avgVol20); // the day's volume so far vs the 50-day norm for this time of day
    const upEdge = st.gapFrom === "prior_close" ? ctx.prevClose : ctx.prevHigh;
    const dnEdge = st.gapFrom === "prior_close" ? ctx.prevClose : ctx.prevLow;
    const dayRange = s.hod[i] - s.lod[i];
    const dayClv = dayRange > 0 ? (b.c - s.lod[i]) / dayRange : 0.5;
    const volOk = crv !== null && crv >= st.gapVolMult;
    const facts = (edge: number) => ({ gapPct: r2(Math.abs(open / edge - 1) * 100), gapAdr: r2(Math.abs(open - edge) / ctx.adr), volMult: r2(crv), pullbackAdr: null, consRangeAdr: null, consDays: 0, earningsGap: String(ctx.earningsToday), fireNo: 1 });
    if (volOk && open >= upEdge * (1 + st.gapMinPct / 100) && open - upEdge >= st.gapMinAdr * ctx.adr && dayClv >= 0.5 && b.c > upEdge && !closedThrough(s, i, upEdge, true) && firstClose(s.orHigh, true)) {
      out.push({ ...hit(true, s.date, 0, upEdge, s.orHigh, "opening_range_high", ctx.sma5, ctx.sma10, s.vwap[i], s.lod[i], null, false, rv, facts(upEdge)), replaces: "orb_breakout" });
    }
    if (volOk && open <= dnEdge * (1 - st.gapMinPct / 100) && dnEdge - open >= st.gapMinAdr * ctx.adr && dayClv <= 0.5 && b.c < dnEdge && !closedThrough(s, i, dnEdge, false) && firstClose(s.orLow, false)) {
      out.push({ ...hit(false, s.date, 0, dnEdge, s.orLow, "opening_range_low", ctx.sma5, ctx.sma10, s.vwap[i], s.hod[i], null, false, rv, facts(dnEdge)), replaces: "orb_breakdown" });
    }
  }
  return out;
};

/** Day 0 has no session close yet: a 5-minute close back through the edge today counts as the gap failing. */
function closedThrough(s: { bars: { c: number }[] }, i: number, edge: number, up: boolean): boolean {
  for (let j = 0; j <= i; j++) if (up ? s.bars[j].c < edge : s.bars[j].c > edge) return true;
  return false;
}

function hit(
  up: boolean, gapDate: string, day: number, edge: number, goLevel: number, goFrom: string,
  sma5: number | null, sma10: number | null, vwap: number, dayExtreme: number, cons: number | null, tight: boolean,
  rv: number, extra: Record<string, number | string | null>,
): TriggerHit {
  const gapLevel: Level = { name: "gap", price: edge, gap: { date: gapDate, dir: up ? "up" : "down", state: day === 0 ? "open" : "filled_held", role: up ? "support" : "resistance" } };
  const levels: Level[] = [gapLevel, { name: "vwap", price: vwap }, { name: up ? "low_of_day" : "high_of_day", price: dayExtreme }];
  if (sma5 !== null) levels.push({ name: "sma5", price: sma5 });
  if (sma10 !== null) levels.push({ name: "sma10", price: sma10 });
  if (cons !== null && (up ? cons > edge : cons < edge)) levels.push({ name: up ? "consolidation_low" : "consolidation_high", price: cons });
  return {
    setupKey: up ? "gap_and_go" : "gap_down_and_go",
    side: up ? "long" : "short",
    variant: `gap:${gapDate}`,
    why: `${up ? "gap up" : "gap down"} ${gapDate} (day ${day}) held its edge ${r2(edge)}; closed ${up ? "above" : "under"} the go level ${r2(goLevel)} (${goFrom}) on ${r2(rv)}x volume`,
    facts: { gapDate, daysSinceGap: day, gapEdge: r2(edge), goLevel: r2(goLevel), goFrom, tight: tight ? 1 : 0, relVol: r2(rv), ...extra },
    stopLevels: levels,
    companyIf: tight ? { level: up ? "consolidation_low" : "consolidation_high", reason: "tight consolidation" } : undefined,
  };
}
