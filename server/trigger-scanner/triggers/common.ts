import type { ScannerSettings } from "../settings";
import type { SessionState } from "../session";
import type { DailyContext, Side, TriggerHit } from "../types";

/** A daily setup the scanner watches today (a Leader Shakeout hit, or a user's stored setup that passed last night). */
export interface DailyWatch {
  setupKey: string;
  setupOwner: string; // "builtin" | "user:<id>"
  ownerUserId: number | null;
  side: Side;
  entryName: string; // "shakeout_close", "prev_high", ...
  entryLevel: number;
  hitDate: string;
  tested: boolean;
  /** The setup's own distance to its entry level, in ADR; the inRangeAdr setting when absent. */
  rangeAdr?: number | null;
}

/** Everything a trigger reads. It looks at bar i (the bar that just closed) and bars before it, never after. */
export interface TriggerInput {
  ctx: DailyContext;
  s: SessionState;
  i: number;
  settings: ScannerSettings;
  watch?: DailyWatch[];
}

export type TriggerFn = (inp: TriggerInput) => TriggerHit[];

export const r2 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
