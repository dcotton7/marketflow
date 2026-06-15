import type { SetupBar } from "./setup-detectors/types";

export interface Reclaim200dReading {
  active: boolean;
  justOnLastBar: boolean;
  pctVs200Now: number | null;
  pctVs200Prior: number | null;
}

function pctVsMa(price: number, ma: number | null | undefined): number | null {
  if (ma == null || ma === 0 || !Number.isFinite(price)) return null;
  return Math.round(((price - ma) / ma) * 1000) / 10;
}

/**
 * Was the consolidation built predominantly below the 200d?
 * Did the latest daily bar reclaim the 200d? (power setup when both true)
 */
export function analyzeBase200dContext(
  bars: SetupBar[],
  sma200Series: (number | null)[] | undefined,
  baseDays: number | null,
  lastSessionPct?: number | null,
  opts?: {
    pctVs200Now?: number | null;
    pctVs50Now?: number | null;
  }
): {
  baseBelow200d: boolean;
  reclaim: Reclaim200dReading;
  powerSetup: boolean;
  summaryLines: string[];
  longSetupPositives: string[];
} {
  const empty = {
    baseBelow200d: false,
    reclaim: {
      active: false,
      justOnLastBar: false,
      pctVs200Now: null,
      pctVs200Prior: null,
    },
    powerSetup: false,
    summaryLines: [] as string[],
    longSetupPositives: [] as string[],
  };

  if (!bars.length || !sma200Series?.length) return empty;

  const n = Math.min(bars.length, sma200Series.length);
  const last = n - 1;
  const prev = n - 2;
  if (prev < 0) return empty;

  const pctNow = pctVsMa(bars[last]!.close, sma200Series[last]);
  const pctPrior = pctVsMa(bars[prev]!.close, sma200Series[prev]);

  const justOnLastBar =
    pctNow != null &&
    pctPrior != null &&
    pctPrior < -0.25 &&
    pctNow >= -0.35 &&
    bars[last]!.close >= (sma200Series[last] ?? 0) * 0.998;

  const reclaimActive = pctNow != null && pctNow >= 0;
  const reclaim = {
    active: reclaimActive || justOnLastBar,
    justOnLastBar,
    pctVs200Now: pctNow,
    pctVs200Prior: pctPrior,
  };

  const pct200Now = opts?.pctVs200Now ?? pctNow;
  const pct50Now = opts?.pctVs50Now ?? null;

  // When price is healthy above 50d/200d now, only judge the RECENT coil — not months-old structure.
  const spanCap =
    pct200Now != null && pct200Now > 0 && pct50Now != null && pct50Now > 0 ? 45 : 90;
  const span = Math.min(baseDays ?? 40, spanCap, n - 2);
  const baseStart = Math.max(0, n - span - 1);
  const baseSlice = bars.slice(baseStart, last);
  let belowCount = 0;
  let measured = 0;
  for (let i = 0; i < baseSlice.length; i++) {
    const idx = baseStart + i;
    const ma = sma200Series[idx];
    if (ma == null) continue;
    measured += 1;
    if (baseSlice[i]!.close < ma) belowCount += 1;
  }

  let baseBelow200d = measured >= 8 && belowCount / measured >= 0.55;
  if (pct200Now != null && pct200Now > 1 && pct50Now != null && pct50Now > 0) {
    baseBelow200d = false;
  }
  const powerSetup = baseBelow200d && reclaim.justOnLastBar;

  const summaryLines: string[] = [];
  const longSetupPositives: string[] = [];

  if (baseBelow200d) {
    summaryLines.push(
      `Base formed below the 200d (${Math.round((belowCount / measured) * 100)}% of base sessions under the 200 SMA) — repair-zone coil, not leadership during the build`
    );
    longSetupPositives.push("Base built under 200d — compressed repair structure");
  }

  if (reclaim.justOnLastBar) {
    const sess =
      lastSessionPct != null && lastSessionPct > 0
        ? ` on a +${lastSessionPct.toFixed(2)}% session`
        : "";
    summaryLines.push(
      `Latest daily bar reclaims the 200d (${pctPrior!.toFixed(1)}% → ${pctNow!.toFixed(1)}% vs 200 SMA)${sess} — strong tell`
    );
    longSetupPositives.push("200d reclaim on last bar");
  } else if (reclaimActive && baseBelow200d) {
    summaryLines.push(
      `Price now above the 200d (+${pctNow!.toFixed(1)}%) after building the base underneath — follow-through leg underway`
    );
  }

  if (powerSetup) {
    summaryLines.push(
      "Power setup: underlying base below the 200d + fresh 200d reclaim — the combination is what gives this trade energy"
    );
    longSetupPositives.push("Power setup: base below 200d + 200d reclaim");
  }

  return {
    baseBelow200d,
    reclaim,
    powerSetup,
    summaryLines: summaryLines.slice(0, 4),
    longSetupPositives: longSetupPositives.slice(0, 4),
  };
}
