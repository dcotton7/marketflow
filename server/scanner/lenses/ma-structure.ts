// ---------------------------------------------------------------------------
// Lens: MA Structure
// "What's the moving-average posture for this ticker?"
// ---------------------------------------------------------------------------

import type { Signal, MaStructureResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";

function describePosture(
  price: number,
  sma20: number | null,
  sma50: number | null,
  sma200: number | null,
): string {
  const above20 = sma20 != null && price > sma20;
  const above50 = sma50 != null && price > sma50;
  const above200 = sma200 != null && price > sma200;

  if (above20 && above50 && above200) return "bullish — above all MAs";
  if (!above20 && !above50 && !above200 && sma20 != null && sma50 != null && sma200 != null)
    return "bearish — below all MAs";
  if (above200 && !above50) return "recovering — above 200d, below 50d";
  if (above50 && !above20) return "pullback — above 50d, below 20d";
  if (!above200 && above20) return "bounce — above 20d, below 200d";
  return "mixed";
}

function classifyStack(
  price: number,
  sma20: number | null,
  sma50: number | null,
  sma200: number | null,
): MaStructureResult["maStack"] {
  if (sma20 == null || sma50 == null || sma200 == null) return "mixed";
  if (price > sma20 && sma20 > sma50 && sma50 > sma200) return "bullish";
  if (price < sma20 && sma20 < sma50 && sma50 < sma200) return "bearish";
  return "mixed";
}

function extensionPct(price: number, ma: number | null): number {
  if (ma == null || ma === 0) return 0;
  return Math.round(((price - ma) / ma) * 10000) / 100;
}

function nearestKeyLevel(
  price: number,
  sma20: number | null,
  sma50: number | null,
  sma200: number | null,
): string | null {
  const levels: { label: string; dist: number }[] = [];
  if (sma20 != null) levels.push({ label: "20d SMA", dist: Math.abs(price - sma20) / price });
  if (sma50 != null) levels.push({ label: "50d SMA", dist: Math.abs(price - sma50) / price });
  if (sma200 != null) levels.push({ label: "200d SMA", dist: Math.abs(price - sma200) / price });

  const PROXIMITY_THRESHOLD = 0.03; // within 3%
  const closest = levels.sort((a, b) => a.dist - b.dist)[0];
  return closest && closest.dist < PROXIMITY_THRESHOLD ? closest.label : null;
}

export const maStructureLens: Lens = {
  id: "ma_structure",

  async apply(signal: Signal, ctx: LensContext): Promise<MaStructureResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    const tick = ctx.currentFrame.tickers.get(signal.subject);
    if (!tick || tick.price <= 0) return null;

    return {
      posture: describePosture(tick.price, tick.sma20d, tick.sma50d, tick.sma200d),
      maStack: classifyStack(tick.price, tick.sma20d, tick.sma50d, tick.sma200d),
      extensionFrom20d: extensionPct(tick.price, tick.sma20d),
      extensionFrom50d: extensionPct(tick.price, tick.sma50d),
      nearKeyLevel: nearestKeyLevel(tick.price, tick.sma20d, tick.sma50d, tick.sma200d),
    };
  },
};
