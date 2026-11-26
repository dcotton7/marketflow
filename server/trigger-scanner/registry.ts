/**
 * The setup registry: one interface for both kinds of setup.
 *   builtin  a trigger written as code (triggers/*), the same for every account.
 *   user     a setup stored as data per account (trigger_user_setups, BigIdea criteria on daily bars), evaluated
 *            before the open into a watch list and raised by the `daily_in_range` trigger on the same bars. Its
 *            candidates carry setup_owner "user:<id>" and are only ever served to that account.
 * Every candidate names its setup key and owner, so results are measured per setup.
 */
import type { ScannerSettings } from "./settings";
import { dailyInRange } from "./triggers/daily-in-range";
import { dayExtremeReversal } from "./triggers/day-extreme-reversal";
import { failedOrb } from "./triggers/failed-orb";
import { levelHold } from "./triggers/level-hold";
import { newExtremeVolume } from "./triggers/new-extreme-volume";
import { orb } from "./triggers/orb";
import { vwapCross } from "./triggers/vwap-cross";
import type { TriggerFn } from "./triggers/common";

export interface SetupInfo {
  key: string;
  kind: "builtin" | "user";
  owner: string; // "builtin" | "user:<id>"
  description: string;
  side: "long" | "short";
  /** The settings this setup reads (names in ScannerSettings) with their defaults. */
  params: (keyof ScannerSettings)[];
  /** Tested = a research-backed record (grade: 2 points); recognised by code but untested: 1; a user's: 0. */
  tested: boolean;
  /** The same setup on the same name (and variant) is not raised again within this many minutes. */
  dedupeMin: number;
}

export interface TriggerModule {
  key: string;
  fn: TriggerFn;
  setups: SetupInfo[];
}

const b = (key: string, side: "long" | "short", description: string, params: (keyof ScannerSettings)[], dedupeMin: number, tested = false): SetupInfo =>
  ({ key, kind: "builtin", owner: "builtin", description, side, params, tested, dedupeMin });

const DAY = 24 * 60;

export const TRIGGERS: TriggerModule[] = [
  { key: "orb", fn: orb, setups: [
    b("orb_breakout", "long", "First 5-minute close above the opening range high, on relative volume", ["orMinutes", "orbUntilMin", "orbMinRelVol"], DAY),
    b("orb_breakdown", "short", "First 5-minute close under the opening range low, on relative volume", ["orMinutes", "orbUntilMin", "orbMinRelVol"], DAY),
  ] },
  { key: "failed_orb", fn: failedOrb, setups: [
    b("failed_orb", "short", "Closed above the opening range, then the first close back inside", ["orMinutes", "failedBreakMinAdr"], 90),
    b("orb_reversal", "long", "Closed under the opening range, then the first close back inside", ["orMinutes", "failedBreakMinAdr"], 90),
  ] },
  { key: "vwap", fn: vwapCross, setups: [
    b("vwap_reclaim", "long", "Close back above session VWAP after N closes under it", ["vwapPriorBars", "vwapMinCrossAdr"], 60),
    b("vwap_loss", "short", "Close back under session VWAP after N closes over it", ["vwapPriorBars", "vwapMinCrossAdr"], 60),
  ] },
  { key: "level", fn: levelHold, setups: [
    b("level_hold", "long", "Tagged a daily level (SMA/EMA, previous low/high, support gap) and closed back above", ["touchTolPct", "levelApproachAdr"], 120),
    b("level_reject", "short", "Tagged a daily level (resistance) from below and closed back under", ["touchTolPct", "levelApproachAdr"], 120),
  ] },
  { key: "day_extreme", fn: dayExtremeReversal, setups: [
    b("lod_reversal", "long", "New low of day after a flush, then a strong up close", ["reversalMinMoveAdr", "reversalCloseShare"], 60),
    b("hod_reversal", "short", "New high of day after a run, then a strong down close", ["reversalMinMoveAdr", "reversalCloseShare"], 60),
  ] },
  { key: "new_extreme", fn: newExtremeVolume, setups: [
    b("new_high_volume", "long", "Close at a new session high on volume above the time-of-day norm", ["newExtremeMinRelVol"], 60),
    b("new_low_volume", "short", "Close at a new session low on volume above the time-of-day norm", ["newExtremeMinRelVol"], 60),
  ] },
  { key: "daily_in_range", fn: dailyInRange, setups: [
    b("leader_shakeout", "long", "A Leader Shakeout hit of the last sessions trading back to its entry level (the drop day's close)", ["inRangeAdr", "shakeoutLookbackSessions"], DAY, true),
  ] },
];

const BUILTIN = new Map(TRIGGERS.flatMap((t) => t.setups).map((s) => [s.key, s]));
const USER = new Map<string, SetupInfo>();

/** A user's stored setup, registered under "user:<id>:<key>" for lookups (dedupe window, tested flag). */
export function registerUserSetup(info: Omit<SetupInfo, "kind" | "params" | "dedupeMin"> & { dedupeMin?: number }): SetupInfo {
  const full: SetupInfo = { ...info, kind: "user", params: ["inRangeAdr"], dedupeMin: info.dedupeMin ?? DAY };
  USER.set(`${full.owner}:${full.key}`, full);
  return full;
}
export function clearUserSetups(): void {
  USER.clear();
}

export function setupInfo(key: string, owner = "builtin"): SetupInfo | undefined {
  return owner === "builtin" ? BUILTIN.get(key) : USER.get(`${owner}:${key}`);
}

export function listSetups(): SetupInfo[] {
  return [...BUILTIN.values(), ...USER.values()];
}
