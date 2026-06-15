import type { SetupBar } from "./types";
import { avgVolume } from "./bars";
import { emptyResult, hitResult } from "./result-helpers";

export interface GapAndGoOptions {
  minGapPct?: number;
  maxBaseDays?: number;
  minBaseDays?: number;
  maxBaseRangePct?: number;
  breakVolumeMultiple?: number;
}

/**
 * Gap ≥ minGapPct overnight, post-gap base, break above base high on volume.
 * Bars: chronological daily.
 */
export function detectGapAndGo(bars: SetupBar[], opts?: GapAndGoOptions) {
  const minGapPct = opts?.minGapPct ?? 5;
  const maxBaseDays = opts?.maxBaseDays ?? 10;
  const minBaseDays = opts?.minBaseDays ?? 2;
  const maxBaseRangePct = opts?.maxBaseRangePct ?? 12;
  const breakVolMult = opts?.breakVolumeMultiple ?? 1.3;

  if (bars.length < minBaseDays + 3) return emptyResult("gap_and_go", "O8");

  const last = bars.length - 1;

  for (let gapIdx = last; gapIdx >= Math.max(1, last - 15); gapIdx--) {
    const gapBar = bars[gapIdx]!;
    const priorClose = bars[gapIdx - 1]!.close;
    if (priorClose <= 0) continue;

    const gapPct = ((gapBar.open - priorClose) / priorClose) * 100;
    if (gapPct < minGapPct) continue;

    const gapFilled = gapBar.low <= priorClose;
    const baseStart = gapIdx + 1;
    if (baseStart >= bars.length) {
      return hitResult("gap_and_go", "O8", "forming", 55, gapBar.high, priorClose, gapBar.high * 1.1, {
        gapPct: gapPct.toFixed(1),
        gapFilled,
        phase: "gap_only",
      });
    }

    const baseEnd = last - 1;
    const baseLen = baseEnd - baseStart + 1;
    if (baseLen < minBaseDays) {
      if (baseLen >= 1) {
        return hitResult("gap_and_go", "O8", "forming", 60, null, priorClose, gapBar.high * 1.08, {
          gapPct: gapPct.toFixed(1),
          phase: "early_base",
          baseDays: baseLen,
        });
      }
      continue;
    }

    if (baseLen > maxBaseDays) continue;

    const baseBars = bars.slice(baseStart, baseEnd + 1);
    const baseHigh = Math.max(...baseBars.map((b) => b.high));
    const baseLow = Math.min(...baseBars.map((b) => b.low));
    const baseRangePct = baseHigh > 0 ? ((baseHigh - baseLow) / baseHigh) * 100 : 100;

    if (baseRangePct > maxBaseRangePct) continue;
    if (baseLow < priorClose * 0.995) continue;

    const gapVol = gapBar.volume;
    const baseAvgVol = avgVolume(baseBars, baseBars.length);
    const volDry = baseAvgVol < gapVol * 0.85;

    const today = bars[last]!;
    const baseAvgVolForBreak = avgVolume(baseBars, baseBars.length);
    const brokeOut = today.close > baseHigh && today.volume >= baseAvgVolForBreak * breakVolMult;

    let stage: "forming" | "ready" | "triggered" | "extended" = "forming";
    if (volDry && today.close <= baseHigh * 1.01 && today.close >= baseLow) stage = "ready";
    if (brokeOut) stage = "triggered";
    if (brokeOut && today.close > baseHigh * 1.06) stage = "extended";

    if (stage === "forming" && !volDry) continue;

    return hitResult("gap_and_go", "O8", stage, brokeOut ? 78 : 65, baseHigh, baseLow, baseHigh * 1.12, {
      gapPct: gapPct.toFixed(1),
      gapFilled,
      baseDays: baseLen,
      baseRangePct: baseRangePct.toFixed(1),
      baseHigh,
      volDry,
    });
  }

  return emptyResult("gap_and_go", "O8");
}
