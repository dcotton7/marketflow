import {
  buildBriefingPreviews,
  resolveBriefingMode,
  resolveBriefingSession,
} from "./session-context";
import { buildThemeBriefingDossier } from "./dossier-builder";
import { buildRulesNarrative } from "./narrative-rules";
import { fetchCategorizedMacroNews } from "./macro-news";
import { buildStoryContext } from "./story-atoms";
import { synthesizeBriefingNarrative, BRIEFING_SYNTHESIS_MODEL } from "./synthesis/engine";
import {
  briefingCachePolicy,
  getBriefingCacheKey,
  getCachedBriefing,
  setCachedBriefing,
} from "./cacheService";
import type { BriefingMode, ThemeBriefingResponse } from "./types";

async function buildFreshThemeBriefing(
  mode: BriefingMode,
  synthesize: boolean
): Promise<ThemeBriefingResponse> {
  const session = await resolveBriefingSession(mode);

  const [dossier, macroNews] = await Promise.all([
    buildThemeBriefingDossier(session),
    fetchCategorizedMacroNews(),
  ]);

  const storyContext = await buildStoryContext(dossier, macroNews);

  let narrative = buildRulesNarrative(dossier, storyContext);
  let synthesisModel: string | undefined;

  const canSynthesize =
    synthesize && dossier.dataQuality.synthesisAvailable && storyContext.atoms.length > 0;

  if (canSynthesize) {
    const result = await synthesizeBriefingNarrative(dossier, storyContext);
    if (result) {
      narrative = result.narrative;
      synthesisModel = result.model;
    }
  }

  const preview = await buildBriefingPreviews(session.anchor);

  return {
    mode: dossier.mode,
    referenceSession: dossier.referenceSession,
    generatedAt: dossier.generatedAt,
    terminalState: dossier.terminalState,
    dataQuality: dossier.dataQuality,
    dossier,
    storyContext,
    narrative,
    preview,
    synthesisModel,
    cached: false,
  };
}

export async function buildThemeBriefing(
  modeParam?: string,
  synthesize = true,
  options?: { force?: boolean }
): Promise<ThemeBriefingResponse> {
  const mode: BriefingMode = resolveBriefingMode(modeParam);
  const session = await resolveBriefingSession(mode);
  const cacheKey = getBriefingCacheKey(mode, session.referenceSession);
  const policy = briefingCachePolicy(mode, session.anchor);

  if (!options?.force && policy.allowRead) {
    const cached = getCachedBriefing(cacheKey);
    if (cached) {
      return {
        ...cached.response,
        cached: true,
        cachedAt: new Date(cached.cachedAt).toISOString(),
      };
    }
  }

  const response = await buildFreshThemeBriefing(mode, synthesize);

  if (policy.allowWrite) {
    setCachedBriefing(cacheKey, response);
  }

  return response;
}

export { buildBriefingPreviews, BRIEFING_SYNTHESIS_MODEL };
