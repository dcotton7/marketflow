import type { DailyBarLike } from "../ticker-review-types";
import type { SetupBar } from "./types";
import { priorBar, sortBarsChronological } from "./bars";
import { emptyResult, hitResult } from "./result-helpers";

/** Prior completed session: close in top third of range + volume ≥ 1.5× 20d avg. */
export function detectHvcFromDailyBars(bars: DailyBarLike[] | SetupBar[]): boolean {
  const sorted = sortBarsChronological(bars as SetupBar[]);
  if (sorted.length < 2) return false;
  const prior = priorBar(sorted)!;
  const range = prior.high - prior.low;
  if (range <= 0) return false;
  const closePosition = (prior.close - prior.low) / range;
  if (closePosition < 0.67) return false;

  const history = sorted.slice(0, -1);
  const volWindow = history.slice(-20);
  if (volWindow.length < 5) {
    return prior.close >= prior.open;
  }
  const avgVol = volWindow.reduce((s, b) => s + b.volume, 0) / volWindow.length;
  if (avgVol <= 0) return false;
  return prior.volume / avgVol >= 1.5;
}

export function detectHvc(bars: SetupBar[]) {
  const sorted = sortBarsChronological(bars);
  const fired = detectHvcFromDailyBars(sorted);
  if (!fired) return emptyResult("hvc", "O7");
  const prior = priorBar(sorted)!;
  return hitResult("hvc", "O7", "ready", 72, null, prior.low, prior.high, {
    closePosition: ((prior.close - prior.low) / (prior.high - prior.low)).toFixed(2),
  });
}
