import type { SetupBar } from "./setup-detectors/types";

export interface LastBarSessionReading {
  toppingWick: boolean;
  upperWickPctOfRange: number | null;
  summaryLines: string[];
}

/** Last daily bar probed higher but closed off the highs — follow-through TBD. */
export function analyzeLastBarSession(bars: SetupBar[]): LastBarSessionReading {
  const empty: LastBarSessionReading = {
    toppingWick: false,
    upperWickPctOfRange: null,
    summaryLines: [],
  };
  if (!bars.length) return empty;

  const bar = bars[bars.length - 1]!;
  const range = bar.high - bar.low;
  if (range <= 0) return empty;

  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const body = Math.abs(bar.close - bar.open);
  const upperWickPct = (upperWick / range) * 100;

  const toppingWick =
    upperWickPct >= 38 &&
    upperWick > body * 1.15 &&
    bar.close < bar.high - range * 0.2;

  if (!toppingWick) return empty;

  return {
    toppingWick: true,
    upperWickPctOfRange: Math.round(upperWickPct * 10) / 10,
    summaryLines: [
      `Last bar probed higher on a long topping wick (${upperWickPct.toFixed(0)}% of range) — breakout follow-through still TBD`,
    ],
  };
}
