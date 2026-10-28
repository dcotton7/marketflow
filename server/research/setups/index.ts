import type { AnySetup, EntrySetup, SignalSetup } from "./types";
import { baseNBreak, bearishBaseNBreak, emaCrossback, exhaustionExtension, failedCrossback, reversalExtension, wedgeDrop, wedgePop } from "./kell";
import { baseBreakout, cupHandle, gapEpisodicPivot, maReclaim, pullbackMa, vcp } from "./library";

/**
 * The setup library: every detector, registered once. To add a setup, write a detector (EntrySetup or SignalSetup)
 * and append it here; strategy versions enable setups and override their params by id. Weinstein Stage 2 is not a
 * setup (Don, 2026-10-28: Weinstein is reference only).
 */
export const SETUPS: AnySetup[] = [
  reversalExtension,
  wedgePop,
  emaCrossback,
  baseNBreak,
  maReclaim(10),
  maReclaim(20),
  maReclaim(50),
  baseBreakout,
  cupHandle,
  vcp,
  pullbackMa(10),
  pullbackMa(20),
  gapEpisodicPivot,
  exhaustionExtension,
  wedgeDrop,
  bearishBaseNBreak,
  failedCrossback,
];

export const ENTRY_SETUPS = SETUPS.filter((s): s is EntrySetup => s.kind === "entry");
export const SIGNAL_SETUPS = SETUPS.filter((s): s is SignalSetup => s.kind !== "entry");

export function setupById(id: string): AnySetup {
  const s = SETUPS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown setup ${id}`);
  return s;
}

const ids = new Set<string>();
for (const s of SETUPS) {
  if (ids.has(s.id)) throw new Error(`Duplicate setup id ${s.id}`);
  ids.add(s.id);
}

export type { AnySetup, EntrySetup, SignalSetup } from "./types";
