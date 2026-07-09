// ---------------------------------------------------------------------------
// Lens: Relative Strength
// "Is this ticker an outlier vs its group — leader or laggard?"
// ---------------------------------------------------------------------------

import type { Signal, RelativeStrengthResult } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import {
  getTickerPrimaryCluster,
  getClusterById,
  type ClusterId,
} from "../../market-condition/universe";

export const relativeStrengthLens: Lens = {
  id: "relative_strength",

  async apply(signal: Signal, ctx: LensContext): Promise<RelativeStrengthResult | null> {
    if (signal.subjectKind !== "ticker") return null;

    const symbol = signal.subject;
    const current = ctx.currentFrame;
    const tick = current.tickers.get(symbol);
    if (!tick) return null;

    const clusterId = getTickerPrimaryCluster(symbol);
    if (!clusterId) return null;

    const cluster = getClusterById(clusterId as ClusterId);
    if (!cluster) return null;

    const allMembers = [...cluster.core, ...cluster.candidates];

    // Gather change percents for all theme members
    const peerChanges: { symbol: string; changePct: number }[] = [];
    for (const peer of allMembers) {
      const peerTick = current.tickers.get(peer);
      if (peerTick) peerChanges.push({ symbol: peer, changePct: peerTick.changePct });
    }

    if (peerChanges.length === 0) return null;

    const avgThemeChange = peerChanges.reduce((s, p) => s + p.changePct, 0) / peerChanges.length;
    const rsVsTheme = Math.round((tick.changePct - avgThemeChange) * 100) / 100;
    const rsVsSpy = Math.round((tick.changePct - current.spyChangePct) * 100) / 100;

    // Rank within theme (1 = strongest)
    peerChanges.sort((a, b) => b.changePct - a.changePct);
    const rsRank = peerChanges.findIndex((p) => p.symbol === symbol) + 1;

    const isDiverging = Math.sign(tick.changePct) !== Math.sign(avgThemeChange)
      && Math.abs(rsVsTheme) >= 1.5;

    let divergenceType: RelativeStrengthResult["divergenceType"] = "aligned";
    if (isDiverging) {
      divergenceType = tick.changePct > avgThemeChange ? "leader" : "laggard";
    }

    return { rsVsTheme, rsVsSpy, rsRank, isDiverging, divergenceType };
  },
};
