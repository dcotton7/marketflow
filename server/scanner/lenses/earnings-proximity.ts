// ---------------------------------------------------------------------------
// Lens: Earnings Proximity
// "Does this ticker have earnings coming up soon?"
//
// Reads ONLY from DB cache — never triggers an API call.
// Data is populated on-demand when a user views a chart.
// ---------------------------------------------------------------------------

import type { Signal, EarningsProximityResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import { getCachedEarningsData } from "../../fundamentals";

const DEFAULT_WINDOW_DAYS = 7;

export const earningsProximityLens: Lens = {
  id: "earnings_proximity",

  async apply(signal: Signal, _ctx: LensContext): Promise<EarningsProximityResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    const cached = await getCachedEarningsData(signal.subject);
    if (!cached || !cached.nextEarningsDate) {
      return { withinNDays: false, daysUntil: null, date: null };
    }

    const daysUntil = cached.nextEarningsDays;
    const withinNDays = daysUntil >= 0 && daysUntil <= DEFAULT_WINDOW_DAYS;

    return {
      withinNDays,
      daysUntil: daysUntil >= 0 ? daysUntil : null,
      date: cached.nextEarningsDate,
      earningsTime: cached.earningsTime,
    };
  },
};
