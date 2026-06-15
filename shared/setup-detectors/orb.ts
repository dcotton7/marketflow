import type { SetupBar } from "./types";
import { avgVolume } from "./bars";
import { emptyResult, hitResult } from "./result-helpers";

export interface OrbOptions {
  /** Max minutes to define range and allow trigger (default 30). */
  maxRangeMinutes?: number;
  /** Minutes per bar (default 1 for 1m chart). */
  barMinutes?: number;
  /** Minimum completed range bars before break counts (1 = ~1 min / early trigger). */
  minRangeBars?: number;
  minBreakoutPct?: number;
  volumeMultiple?: number;
}

/**
 * Opening range breakout on intraday bars (chronological, today's session).
 * Range builds from first bar; trigger allowed after minRangeBars within maxRangeMinutes.
 */
export function detectOrb(bars: SetupBar[], opts?: OrbOptions) {
  const maxRangeMinutes = opts?.maxRangeMinutes ?? 30;
  const barMinutes = opts?.barMinutes ?? 1;
  const minRangeBars = opts?.minRangeBars ?? 1;
  const minBreakout = (opts?.minBreakoutPct ?? 0.05) / 100;
  const volumeMult = opts?.volumeMultiple ?? 1.2;

  const maxBars = Math.floor(maxRangeMinutes / barMinutes);
  if (bars.length < minRangeBars + 1) return emptyResult("orb", "O9");

  const sessionBars = bars.slice(0, Math.min(bars.length, maxBars + 5));
  const today = sessionBars[sessionBars.length - 1]!;

  for (let rangeEnd = minRangeBars; rangeEnd <= Math.min(maxBars, sessionBars.length - 1); rangeEnd++) {
    const rangeSlice = sessionBars.slice(0, rangeEnd);
    const orbHigh = Math.max(...rangeSlice.map((b) => b.high));
    const orbLow = Math.min(...rangeSlice.map((b) => b.low));

    for (let i = rangeEnd; i < Math.min(sessionBars.length, maxBars + 1); i++) {
      const bar = sessionBars[i]!;
      const breakoutUp = bar.high > orbHigh * (1 + minBreakout);
      if (!breakoutUp) continue;

      const rangeVol = avgVolume(rangeSlice, rangeSlice.length);
      const volOk = rangeVol <= 0 || bar.volume >= rangeVol * volumeMult;

      let stage: "ready" | "triggered" | "extended" = volOk ? "triggered" : "ready";
      if (bar.close > orbHigh * 1.015) stage = "extended";
      if (i === sessionBars.length - 1 && bar.close <= orbHigh) stage = "ready";

      return hitResult("orb", "O9", stage, volOk ? 74 : 58, orbHigh, orbLow, orbHigh * 1.02, {
        orbHigh,
        orbLow,
        rangeBars: rangeEnd,
        breakBar: i,
        volumeConfirm: volOk,
      });
    }
  }

  const rangeSlice = sessionBars.slice(0, Math.min(minRangeBars, sessionBars.length));
  if (rangeSlice.length >= minRangeBars) {
    const orbHigh = Math.max(...rangeSlice.map((b) => b.high));
    const orbLow = Math.min(...rangeSlice.map((b) => b.low));
    const inside = today.close >= orbLow && today.close <= orbHigh * 1.002;
    if (inside && sessionBars.length <= maxBars) {
      return hitResult("orb", "O9", "forming", 52, orbHigh, orbLow, orbHigh * 1.01, {
        orbHigh,
        orbLow,
        rangeBars: rangeSlice.length,
        phase: "inside_range",
      });
    }
  }

  return emptyResult("orb", "O9");
}
