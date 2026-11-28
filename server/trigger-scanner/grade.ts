/**
 * The code grade (Anitir spec 5.e; v3, 28 Nov, after the first live session: "scanner loose: Tighten"). 11 points at
 * most; every number a setting; the components are stored on each candidate.
 *   risk (0-3)       the stop's distance in ADR: in [riskBestLoAdr 0.45, riskBestHiAdr 1.0]: 3; up to riskOkHiAdr 1.5: 2;
 *                    under 0.45 (down to the minRiskAdr floor) or up to riskWideAdr 2.0: 1; wider: 0. A stop past
 *                    riskCapPct 3% scores at most riskCapPoints 2. (v2 gave 4 for any stop <= 1.5%, which rewarded
 *                    stops inside the noise.)
 *   level (0-2)      the weight of the level the trade is about (levels.ts levelWeight): a level hold/reject's tagged
 *                    level, every other setup's stop level. Heavy 2, intraday 1, light 0.
 *   volume (0-2)     the trigger bar's relative volume: >= volStrong 1.5x: 2; >= volOk 0.75x: 1; else (or unknown) 0.
 *   exitLogic (0-1)  the stop's level has company (another level within companyAdr).
 *   setup (0-1)      tested (a research-backed record): 1; a built-in or a user's setup, untested: 0.
 *   regime (0-1)     not against it: the side the regime leans to, or NEUTRAL: 1; against it or unknown: 0 (noted).
 *   rotation (0-1)   size bucket or sector leading: 1.
 *   liquidity (-1-0) 20-day dollar volume under liquidDollarVol ($100M): -1.
 *   earnings (-2-0)  a report within earningsWithinSessions sessions: -2; calendar not loaded for the name: 0 (noted).
 * A at gradeA (8) or more AND a volume point of at least gradeAMinVolume (1) (else B, noted); B at gradeB (5) to 7; C below.
 */
import { levelWeight } from "./levels";
import type { GradeComponents, Regime, Side } from "./types";

export interface GradeInput {
  side: Side;
  riskPct: number;
  riskAdr: number;
  hasCompany: boolean;
  setupKind: "tested" | "builtin" | "user";
  regime: Regime;
  groupLeading: boolean;
  dollarVol20: number;
  /** Sessions until the next report (0 = today), null when the calendar has none in range; undefined = not known. */
  earningsInSessions: number | null | undefined;
  /** The trigger bar's relative volume (null: no norm). */
  relVol: number | null;
  /** The level the trade is about (a level setup's tagged level, else the stop's level). */
  levelName: string;
}

export interface GradeSettings {
  liquidDollarVol: number; earningsWithinSessions: number; gradeA: number; gradeB: number;
  riskBestLoAdr: number; riskBestHiAdr: number; riskOkHiAdr: number; riskWideAdr: number; riskCapPct: number; riskCapPoints: number;
  volStrong: number; volOk: number; gradeAMinVolume: number;
}

export function riskPoints(riskPct: number, riskAdr: number, s: GradeSettings): number {
  const r = riskAdr;
  let p = !Number.isFinite(r) ? 0 : r >= s.riskBestLoAdr && r <= s.riskBestHiAdr ? 3 : r > s.riskBestHiAdr && r <= s.riskOkHiAdr ? 2 : r < s.riskBestLoAdr || r <= s.riskWideAdr ? 1 : 0;
  if (riskPct > s.riskCapPct) p = Math.min(p, s.riskCapPoints);
  return p;
}

export function gradeCandidate(g: GradeInput, s: GradeSettings): { grade: "A" | "B" | "C"; points: number; components: GradeComponents } {
  const notes: string[] = [];
  const risk = riskPoints(g.riskPct, g.riskAdr, s);
  if (g.riskPct > s.riskCapPct) notes.push(`risk ${Math.round(g.riskPct * 100) / 100}% over ${s.riskCapPct}%: risk at most ${s.riskCapPoints}`);
  const level = levelWeight(g.levelName);
  const volume = g.relVol === null || !Number.isFinite(g.relVol) ? 0 : g.relVol >= s.volStrong ? 2 : g.relVol >= s.volOk ? 1 : 0;
  if (g.relVol === null) notes.push("relative volume unknown: 0");
  const exitLogic = g.hasCompany ? 1 : 0;
  const setup = g.setupKind === "tested" ? 1 : 0;
  let regime = 0;
  if (!g.regime.label) notes.push("regime unknown: 0");
  else if (g.regime.label === "NEUTRAL" || (g.regime.label === "AGGRESSIVE" && g.side === "long") || (g.regime.label === "DEFENSIVE" && g.side === "short")) regime = 1;
  else notes.push(`against the regime (${g.regime.label})`);
  const rotation = g.groupLeading ? 1 : 0;
  const liquidity = g.dollarVol20 >= s.liquidDollarVol ? 0 : -1;
  let earnings = 0;
  if (g.earningsInSessions === undefined) notes.push("earnings date not checked: 0");
  else if (g.earningsInSessions !== null && g.earningsInSessions <= s.earningsWithinSessions) {
    earnings = -2;
    notes.push(`earnings in ${g.earningsInSessions} session(s)`);
  }
  const points = risk + level + volume + exitLogic + setup + regime + rotation + liquidity + earnings;
  let grade: "A" | "B" | "C" = points >= s.gradeA ? "A" : points >= s.gradeB ? "B" : "C";
  if (grade === "A" && volume < s.gradeAMinVolume) {
    grade = "B";
    notes.push(`A on points but the bar's volume is under ${s.volOk}x its norm: B`);
  }
  return { grade, points, components: { risk, level, volume, exitLogic, setup, regime, rotation, liquidity, earnings, notes } };
}
