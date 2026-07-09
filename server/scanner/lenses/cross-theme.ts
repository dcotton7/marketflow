// ---------------------------------------------------------------------------
// Lens: Cross-Theme Contagion
// "Is the move spreading to other themes?"
//
// Uses median member PRICE change (not score delta) for accurate display.
// ---------------------------------------------------------------------------

import type { Signal, CrossThemeResult, CrossThemeEntry } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import { getTickerPrimaryCluster, getClusterTickers, type ClusterId } from "../../market-condition/universe";

const WINDOW = 20;

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export const crossThemeLens: Lens = {
  id: "cross_theme",

  async apply(signal: Signal, ctx: LensContext): Promise<CrossThemeResult | null> {
    const sourceTheme = signal.subjectKind === "theme"
      ? signal.subject
      : getTickerPrimaryCluster(signal.subject) ?? null;

    const prev = ctx.getFrame(WINDOW);
    if (!prev) return null;

    const current = ctx.currentFrame;
    const direction = signal.direction === "down" ? -1 : 1;
    const contagion: CrossThemeEntry[] = [];

    current.themes.forEach((theme, themeId) => {
      if (themeId === sourceTheme) return;
      const prevTheme = prev!.themes.get(themeId);
      if (!prevTheme) return;

      // Compute median member price change for this theme
      const members = getClusterTickers(themeId as ClusterId);
      const memberChanges: number[] = [];
      if (members.length > 0) {
        for (const sym of members) {
          const tick = current.tickers.get(sym.toUpperCase());
          if (tick && tick.changePct !== 0) {
            memberChanges.push(tick.changePct);
          }
        }
      }

      const medianChange = memberChanges.length > 0 ? median(memberChanges) : 0;

      // Theme is "following" if median member price moved in the same direction
      if (Math.sign(medianChange) !== direction || Math.abs(medianChange) < 0.3) return;

      const correlation = Math.min(1, Math.abs(medianChange) / 3);

      contagion.push({
        themeId,
        correlation: Math.round(correlation * 100) / 100,
        changePct: Math.round(medianChange * 100) / 100,
      });
    });

    contagion.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    const spreadScore = Math.min(1,
      contagion.length / Math.max(1, current.themes.size - 1)
    );

    let interpretation: CrossThemeResult["interpretation"] = "isolated";
    if (spreadScore >= 0.5) {
      interpretation = direction < 0 ? "risk_off_cascade" : "risk_on_surge";
    } else if (contagion.length >= 2) {
      interpretation = "sector_bleed";
    }

    return {
      contagion: contagion.slice(0, 5),
      spreadScore: Math.round(spreadScore * 100) / 100,
      interpretation,
    };
  },
};
