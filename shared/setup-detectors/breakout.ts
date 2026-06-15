import type { SetupBar, SetupTechnicals } from "./types";
import { avgVolume } from "./bars";
import { emptyResult, hitResult } from "./result-helpers";

export function detectBreakout(bars: SetupBar[], technicals?: SetupTechnicals) {
  if (bars.length < 20) return emptyResult("breakout", "O10");

  const current = bars[bars.length - 1]!;
  const recent20 = bars.slice(-20);
  const recent20High = Math.max(...recent20.map((b) => b.high));
  const recent20Low = Math.min(...recent20.map((b) => b.low));

  const breakingOut = current.close > recent20High * 0.98;
  if (!breakingOut) return emptyResult("breakout", "O10");

  const avgVol = avgVolume(bars.slice(-21, -1), 20);
  const volConfirm = avgVol > 0 && current.volume > avgVol * 1.3;
  const confidence = volConfirm ? 75 : 55;

  let stage: "ready" | "triggered" | "extended" = "ready";
  if (current.close > recent20High) stage = "triggered";
  if (current.close > recent20High * 1.08) stage = "extended";

  const high52 = technicals?.high52Week ?? recent20High * 1.2;

  return hitResult("breakout", "O10", stage, confidence, recent20High, recent20Low, high52, {
    volumeConfirm: volConfirm,
    baseHigh: recent20High,
  });
}
