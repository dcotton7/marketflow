/**
 * Rank saved enrich models by relevance to the current chart dossier.
 */

import type {
  ChartEnrichLifecycleStage,
  ChartEnrichModelTier,
  ChartEnrichPatternLabel,
  ChartSetupEnrichDossier,
  ChartSetupEnrichResult,
} from "./chart-setup-enrich";

const OPTIONAL_TO_PATTERN: Record<string, ChartEnrichPatternLabel> = {
  O5: "undercut_rally",
  O6: "vcp",
  O8: "breakout",
  O9: "orb",
  O10: "gap_and_go",
};

const TIER_SCORE: Record<ChartEnrichModelTier, number> = {
  gold: 25,
  silver: 12,
  bronze: 5,
};

export interface ChartEnrichModelRowLike {
  symbol: string;
  tier: string;
  note: string | null;
  patternLabel: string | null;
  lifecycleStage: string | null;
  scopes: string[] | null;
  enrichSnapshot: ChartSetupEnrichResult | null;
}

export interface RankedEnrichModel {
  symbol: string;
  tier: string;
  note: string | null;
  result: ChartSetupEnrichResult;
  score: number;
  matchReasons: string[];
}

/** Patterns likely relevant to this enrich request (from scan + structure). */
export function inferPatternCandidatesFromDossier(
  dossier: ChartSetupEnrichDossier
): ChartEnrichPatternLabel[] {
  const out = new Set<ChartEnrichPatternLabel>();
  const scan = dossier.scanRow as {
    firedOptional?: string[];
    patternHits?: { pattern?: string; criterionId?: string }[];
  } | null;

  for (const id of scan?.firedOptional ?? []) {
    const p = OPTIONAL_TO_PATTERN[id];
    if (p) out.add(p);
  }

  for (const hit of scan?.patternHits ?? []) {
    const p = hit.pattern as ChartEnrichPatternLabel | undefined;
    if (p && p !== "none_unclear") out.add(p);
  }

  const m = dossier.metrics as { extensionFrom50dPct?: number } | null | undefined;
  const ext50 = m?.extensionFrom50dPct;
  if (ext50 != null && ext50 > 6) out.add("breakout");

  if (dossier.urMeta?.buyableNow || dossier.urMeta?.detected) out.add("undercut_rally");

  if (!out.size) out.add("none_unclear");
  return [...out];
}

export function inferLifecycleCandidateFromDossier(
  dossier: ChartSetupEnrichDossier
): ChartEnrichLifecycleStage | null {
  if (dossier.urMeta?.buyableNow) return "triggering";

  const m = dossier.metrics as { extensionFrom50dPct?: number } | null | undefined;
  const ext50 = m?.extensionFrom50dPct;
  if (ext50 == null) return null;
  if (ext50 > 10) return "extended";
  if (ext50 > 5) return "post_rally";
  if (ext50 > 2) return "triggering";
  return "pre_setup";
}

function modelPattern(row: ChartEnrichModelRowLike): ChartEnrichPatternLabel | null {
  if (row.patternLabel) return row.patternLabel as ChartEnrichPatternLabel;
  return row.enrichSnapshot?.patternLabel ?? null;
}

function modelLifecycle(row: ChartEnrichModelRowLike): ChartEnrichLifecycleStage | null {
  if (row.lifecycleStage) return row.lifecycleStage as ChartEnrichLifecycleStage;
  return row.enrichSnapshot?.lifecycleStage ?? null;
}

export function scoreEnrichModelRelevance(
  row: ChartEnrichModelRowLike,
  patternCandidates: ChartEnrichPatternLabel[],
  lifecycleCandidate: ChartEnrichLifecycleStage | null
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const tier = row.tier as ChartEnrichModelTier;
  if (TIER_SCORE[tier]) {
    score += TIER_SCORE[tier];
    reasons.push(`${tier} tier`);
  }

  const mp = modelPattern(row);
  if (mp && patternCandidates.includes(mp)) {
    score += 100;
    reasons.push(`pattern ${mp}`);
  } else if (mp && mp !== "none_unclear" && patternCandidates.includes("none_unclear")) {
    score += 15;
    reasons.push(`pattern ${mp} (weak)`);
  }

  const scopes = row.scopes ?? [];
  if (scopes.includes("pattern") && mp && patternCandidates.includes(mp)) {
    score += 20;
    reasons.push("pattern scope");
  }
  if (scopes.includes("lifecycle")) {
    score += 8;
    reasons.push("lifecycle scope");
  }
  if (scopes.includes("full_read")) {
    score += 5;
  }

  const ml = modelLifecycle(row);
  if (ml && lifecycleCandidate && ml === lifecycleCandidate) {
    score += 40;
    reasons.push(`lifecycle ${ml}`);
  }

  if (row.note?.trim()) {
    score += 6;
    reasons.push("has note");
  }

  return { score, reasons };
}

const MAX_MODELS = 6;
const MIN_RELEVANCE_SCORE = 30;

/** Pick the most relevant saved models for this dossier (not merely the most recent). */
export function rankEnrichModelsForDossier(
  rows: ChartEnrichModelRowLike[],
  dossier: ChartSetupEnrichDossier
): RankedEnrichModel[] {
  const patternCandidates = inferPatternCandidatesFromDossier(dossier);
  const lifecycleCandidate = inferLifecycleCandidateFromDossier(dossier);

  const ranked = rows
    .filter((r) => r.enrichSnapshot)
    .map((r) => {
      const { score, reasons } = scoreEnrichModelRelevance(
        r,
        patternCandidates,
        lifecycleCandidate
      );
      return {
        symbol: r.symbol,
        tier: r.tier,
        note: r.note,
        result: r.enrichSnapshot!,
        score,
        matchReasons: reasons,
      };
    })
    .filter((r) => r.score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.score - a.score);

  const patternHits = ranked.filter((r) =>
    r.matchReasons.some((x) => x.startsWith("pattern ") && !x.includes("(weak)"))
  );

  const picked = (patternHits.length > 0 ? patternHits : ranked).slice(0, MAX_MODELS);

  return picked;
}
