// ---------------------------------------------------------------------------
// Lens: Earnings Proximity
// "Does this ticker have earnings coming up soon?"
//
// TODO: Wire in a real earnings calendar data source (e.g. Finnhub, FMP).
// Until then, returns a safe default so pipelines that reference this lens
// still get a result and don't silently skip the filter.
// ---------------------------------------------------------------------------

import type { Signal, EarningsProximityResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";

export const earningsProximityLens: Lens = {
  id: "earnings_proximity",

  async apply(signal: Signal, _ctx: LensContext): Promise<EarningsProximityResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    // Stub — no earnings data source wired yet
    return {
      withinNDays: false,
      daysUntil: null,
      date: null,
    };
  },
};
