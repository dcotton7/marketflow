// ---------------------------------------------------------------------------
// Lens: Fastest Movers
// "Who's moving the most right now, and is it concentrated in a theme?"
//
// Reports both short-window velocity AND day-change to avoid misleading
// "fastest dropper" labels on tickers that are actually green on the day.
// ---------------------------------------------------------------------------

import type { Signal, FastestMoversResult, FastestMoverEntry } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import { getTickerPrimaryCluster } from "../../market-condition/universe";

const MOVER_WINDOW = 20; // ~10 min at 30s
const TOP_N = 10;

export const fastestMoversLens: Lens = {
  id: "fastest_movers",

  async apply(signal: Signal, ctx: LensContext): Promise<FastestMoversResult | null> {
    const current = ctx.currentFrame;
    const prev = ctx.getFrame(MOVER_WINDOW);
    if (!prev) return null;

    const direction = signal.direction === "down" ? -1 : 1;

    const movers: FastestMoverEntry[] = [];
    current.tickers.forEach((tick, symbol) => {
      const prevTick = prev!.tickers.get(symbol);
      if (!prevTick || prevTick.price <= 0) return;

      // Short-window velocity (10 min)
      const velocityPct = ((tick.price - prevTick.price) / prevTick.price) * 100;

      // Day change (open-to-now) — used for validation
      const dayChangePct = tick.changePct;

      // For "down" signals, the ticker must be actually moving down recently AND red on the day
      if (direction < 0 && (velocityPct >= 0 || dayChangePct >= 0)) return;
      // For "up" signals, ticker must be moving up recently AND green on the day
      if (direction > 0 && (velocityPct <= 0 || dayChangePct <= 0)) return;

      const volumeRatio = tick.avgVolume14d > 0 ? tick.volume / tick.avgVolume14d : 0;

      movers.push({
        symbol,
        changePct: Math.round(dayChangePct * 100) / 100,
        volumeRatio: Math.round(volumeRatio * 10) / 10,
        themeId: getTickerPrimaryCluster(symbol) ?? "unknown",
      });
    });

    // Sort by magnitude of day change (not velocity) — represents real market impact
    movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    const topMovers = movers.slice(0, TOP_N);

    // Theme concentration
    const themeConcentration: Record<string, number> = {};
    for (const m of topMovers) {
      themeConcentration[m.themeId] = (themeConcentration[m.themeId] ?? 0) + 1;
    }

    const uniqueThemes = Object.keys(themeConcentration).length;
    const isBroadBased = uniqueThemes >= 3;

    return { movers: topMovers, themeConcentration, isBroadBased };
  },
};
