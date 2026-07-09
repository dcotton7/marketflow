// ---------------------------------------------------------------------------
// Lens Registry — all lenses registered by ID
// ---------------------------------------------------------------------------

import type { LensId, LensResult, Signal } from "@shared/scanner-types";
import type { Lens, LensContext } from "./types";
import { themeMembershipLens } from "./theme-membership";
import { peerVelocityLens } from "./peer-velocity";
import { sectorFlowLens } from "./sector-flow";
import { regimeContextLens } from "./regime-context";
import { fastestMoversLens } from "./fastest-movers";
import { crossThemeLens } from "./cross-theme";
import { relativeStrengthLens } from "./relative-strength";
import { maStructureLens } from "./ma-structure";
import { earningsProximityLens } from "./earnings-proximity";
import { newsLens } from "./news";

const ALL_LENSES: Lens[] = [
  themeMembershipLens,
  peerVelocityLens,
  sectorFlowLens,
  regimeContextLens,
  fastestMoversLens,
  crossThemeLens,
  relativeStrengthLens,
  maStructureLens,
  earningsProximityLens,
  newsLens,
];

const lensMap = new Map<LensId, Lens>(
  ALL_LENSES.map((l) => [l.id, l])
);

/**
 * Evaluate a set of lenses for a given signal.
 * Returns a partial map of lens results (null results are omitted).
 * Each lens has a 50ms timeout to prevent slow lenses from blocking the pipeline.
 */
export async function evaluateLenses(
  lensIds: LensId[],
  signal: Signal,
  ctx: LensContext
): Promise<Partial<Record<LensId, LensResult>>> {
  const results: Partial<Record<LensId, LensResult>> = {};

  const promises = lensIds.map(async (id) => {
    const lens = lensMap.get(id);
    if (!lens) return;

    try {
      const timeout = id === "news" ? 6000 : 50;
      const result = await Promise.race([
        lens.apply(signal, ctx),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
      ]);
      if (result) results[id] = result;
    } catch (err) {
      console.warn(`[Scanner] Lens ${id} failed for ${signal.subject}:`, err);
    }
  });

  await Promise.all(promises);
  return results;
}

export { type Lens, type LensContext } from "./types";
