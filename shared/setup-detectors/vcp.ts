import type { SetupBar } from "./types";
import { emptyResult, hitResult } from "./result-helpers";

export function detectVcp(bars: SetupBar[]) {
  if (bars.length < 30) return emptyResult("vcp", "O6");

  const recent30 = bars.slice(-30);
  const ranges: number[] = [];

  for (let i = 0; i < 4; i++) {
    const weekBars = recent30.slice(i * 7, (i + 1) * 7);
    if (weekBars.length > 0) {
      ranges.push(Math.max(...weekBars.map((b) => b.high)) - Math.min(...weekBars.map((b) => b.low)));
    }
  }

  let contracting = true;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]! > ranges[i - 1]! * 0.9) {
      contracting = false;
      break;
    }
  }
  if (!contracting) return emptyResult("vcp", "O6");

  const currentPrice = bars[bars.length - 1]!.close;
  const pivotHigh = Math.max(...recent30.map((b) => b.high));
  const recentLow = Math.min(...bars.slice(-10).map((b) => b.low));
  const distToPivot = ((pivotHigh - currentPrice) / currentPrice) * 100;

  let stage: "forming" | "ready" | "triggered" | "extended" = "forming";
  if (distToPivot < 2) stage = "ready";
  if (currentPrice > pivotHigh) stage = "triggered";
  if (currentPrice > pivotHigh * 1.1) stage = "extended";

  const confidence = Math.min(90, 50 + (4 - ranges.length) * 10 + (distToPivot < 3 ? 20 : 0));

  return hitResult("vcp", "O6", stage, confidence, pivotHigh, recentLow * 0.98, pivotHigh * 1.15, {
    distToPivotPct: distToPivot.toFixed(1),
    weeklyRanges: ranges.length,
  });
}
