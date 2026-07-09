// ---------------------------------------------------------------------------
// Lens: Sector Flow
// "What's the theme doing as a whole — flow, breadth, acceleration?"
// ---------------------------------------------------------------------------

import type { Signal, SectorFlowResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import { getTickerPrimaryCluster } from "../../market-condition/universe";

export const sectorFlowLens: Lens = {
  id: "sector_flow",

  async apply(signal: Signal, ctx: LensContext): Promise<SectorFlowResult | null> {
    const themeId = signal.subjectKind === "theme"
      ? signal.subject
      : getTickerPrimaryCluster(signal.subject) ?? null;

    if (!themeId) return null;

    const theme = ctx.currentFrame.themes.get(themeId);
    if (!theme) return null;

    const totalMembers = theme.memberCount || 1;
    const neutral = totalMembers - theme.membersUp - theme.membersDown;

    // Volume profile based on how many members are surging
    const upRatio = theme.membersUp / totalMembers;
    let volumeProfile: SectorFlowResult["volumeProfile"] = "normal";
    if (upRatio >= 0.8 || upRatio <= 0.2) volumeProfile = "surging";
    else if (upRatio >= 0.65 || upRatio <= 0.35) volumeProfile = "elevated";

    const relativeToMarket = Math.round((theme.score - ctx.currentFrame.spyChangePct) * 100) / 100;

    return {
      themeChangePct: Math.round(theme.score * 100) / 100,
      adRatio: {
        up: theme.membersUp,
        down: theme.membersDown,
        neutral: Math.max(0, neutral),
      },
      acceleration: Math.round(theme.acceleration * 100) / 100,
      flowScore: Math.round(theme.score * 10),
      volumeProfile,
      relativeToMarket,
    };
  },
};
