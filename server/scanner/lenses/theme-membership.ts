// ---------------------------------------------------------------------------
// Lens: Theme Membership
// "What group does this ticker belong to, and who are its peers?"
// ---------------------------------------------------------------------------

import type { Signal, ThemeMembershipResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import {
  getTickerPrimaryCluster,
  getClusterById,
  type ClusterId,
} from "../../market-condition/universe";

export const themeMembershipLens: Lens = {
  id: "theme_membership",

  async apply(signal: Signal, ctx: LensContext): Promise<ThemeMembershipResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    const symbol = signal.subject;
    const clusterId = getTickerPrimaryCluster(symbol);
    if (!clusterId) return null;

    const cluster = getClusterById(clusterId as ClusterId);
    if (!cluster) return null;

    const isCore = cluster.core.includes(symbol);
    const peerSymbols = [...cluster.core, ...cluster.candidates].filter((s) => s !== symbol);
    const themeFrame = ctx.currentFrame.themes.get(clusterId);

    return {
      themeId: clusterId,
      themeName: clusterId.replace(/_/g, " "),
      role: isCore ? "core" : "candidate",
      peerSymbols,
      etfProxy: cluster.etfProxies?.[0]?.symbol ?? null,
      themeScore: themeFrame?.score ?? 0,
      themeRank: themeFrame?.rank ?? 0,
      themePercentile: themeFrame?.percentile ?? 0,
    };
  },
};
