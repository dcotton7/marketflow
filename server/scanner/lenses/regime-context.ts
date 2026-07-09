// ---------------------------------------------------------------------------
// Lens: Regime Context
// "What's the broad market backdrop right now?"
// ---------------------------------------------------------------------------

import type { Signal, RegimeContextResult, MarketSession } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";

function getMarketSession(): MarketSession {
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const h = parseInt(et.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(et.find((p) => p.type === "minute")?.value ?? "0", 10);
  const day = et.find((p) => p.type === "weekday")?.value ?? "";

  if (["Sat", "Sun"].includes(day)) return "closed";

  const mins = h * 60 + m;

  if (mins < 4 * 60) return "closed";
  if (mins < 9 * 60 + 30) return "pre_market";
  if (mins < 10 * 60) return "open_drive";
  if (mins < 12 * 60) return "mid_morning";
  if (mins < 14 * 60) return "midday";
  if (mins < 15 * 60 + 30) return "power_hour";
  if (mins < 16 * 60) return "close";
  if (mins < 20 * 60) return "after_hours";
  return "closed";
}

const RAI_WINDOW = 10; // ~5 min

export const regimeContextLens: Lens = {
  id: "regime_context",

  async apply(signal: Signal, ctx: LensContext): Promise<RegimeContextResult | null> {
    const current = ctx.currentFrame;
    const prev = ctx.getFrame(RAI_WINDOW);

    let themesUp = 0;
    let themesDown = 0;
    let neutral = 0;
    current.themes.forEach((theme) => {
      if (theme.score > 0.5) themesUp++;
      else if (theme.score < -0.5) themesDown++;
      else neutral++;
    });

    return {
      rai: Math.round(current.rai * 10) / 10,
      raiDelta5min: prev
        ? Math.round((current.rai - prev.rai) * 10) / 10
        : 0,
      regime: current.regime,
      spyChangePct: Math.round(current.spyChangePct * 100) / 100,
      breadth: { themesUp, themesDown, neutral },
      session: getMarketSession(),
    };
  },
};
