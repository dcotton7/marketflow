/**
 * The code grade (Anitir spec 5.e, 11 points; every number a setting, the components stored on each candidate):
 *   risk distance (R4, "one of the biggest factors"): stop <= 1.5% or <= 0.5 ADR: 4; <= 3% or <= 1 ADR: 2; <= 5%: 0
 *   exit logic: the stop's level has company (another level within companyAdr): 1
 *   setup: tested (research-backed record): 2; a built-in trigger, untested: 1; a user's own setup: 0
 *   regime fit: the side the regime leans to (AGGRESSIVE long, DEFENSIVE short): 2; NEUTRAL: 1; against it: 0;
 *               regime unknown: 0 (noted)
 *   rotation fit: size bucket or sector leading: 1
 *   liquidity: 20-day dollar volume >= liquidDollarVol ($100M): 1
 *   earnings within earningsWithinSessions sessions: -2; calendar not loaded for the name: 0 (noted)
 * A at gradeA (8) or more, B at gradeB (5) to 7, C below.
 */
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
}

export interface GradeSettings { liquidDollarVol: number; earningsWithinSessions: number; gradeA: number; gradeB: number }

export function gradeCandidate(g: GradeInput, s: GradeSettings): { grade: "A" | "B" | "C"; points: number; components: GradeComponents } {
  const notes: string[] = [];
  const risk = g.riskPct <= 1.5 || g.riskAdr <= 0.5 ? 4 : g.riskPct <= 3 || g.riskAdr <= 1 ? 2 : 0;
  const exitLogic = g.hasCompany ? 1 : 0;
  const setup = g.setupKind === "tested" ? 2 : g.setupKind === "builtin" ? 1 : 0;
  let regime = 0;
  if (!g.regime.label) notes.push("regime unknown: 0");
  else if (g.regime.label === "NEUTRAL") regime = 1;
  else if ((g.regime.label === "AGGRESSIVE" && g.side === "long") || (g.regime.label === "DEFENSIVE" && g.side === "short")) regime = 2;
  else notes.push(`against the regime (${g.regime.label})`);
  const rotation = g.groupLeading ? 1 : 0;
  const liquidity = g.dollarVol20 >= s.liquidDollarVol ? 1 : 0;
  let earnings = 0;
  if (g.earningsInSessions === undefined) notes.push("earnings date not checked: 0");
  else if (g.earningsInSessions !== null && g.earningsInSessions <= s.earningsWithinSessions) {
    earnings = -2;
    notes.push(`earnings in ${g.earningsInSessions} session(s)`);
  }
  const points = risk + exitLogic + setup + regime + rotation + liquidity + earnings;
  const grade = points >= s.gradeA ? "A" : points >= s.gradeB ? "B" : "C";
  return { grade, points, components: { risk, exitLogic, setup, regime, rotation, liquidity, earnings, notes } };
}
