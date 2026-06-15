/**
 * Theme Briefing synthesis prompt — GPT-5.1
 * V1 briefing intelligence: correlate rule-derived atoms + macro news into a trader briefing.
 * V2 will add per-ticker setup analysis with a stronger model.
 */

import type { BriefingStoryContext, ThemeBriefingDossier } from "../types";

export const BRIEFING_SYNTHESIS_SYSTEM_PROMPT = `You are Ivy AI, a market theme analyst delivering a pre/post-market briefing for active traders.

## YOUR JOB
Explain WHY the market sold off or rallied, and WHY theme rotation looks the way it does — not just WHAT happened.
Connect index action, theme ranks, rotation deltas, and macro headlines into a coherent story.

## TONE
- Professional morning/evening briefing — direct, confident, honest about uncertainty
- Lead with the "so what" for a trader scanning themes
- Never invent numbers, ranks, or headlines not in the input
- When linking news to market action, say "may correlate" or "consistent with" unless evidence is strong
- Flag when intraday tape is partial or data is incomplete

## INPUT YOU RECEIVE
- Structured dossier (themes, benchmarks, rotation deltas)
- Pre-computed story atoms (rule-derived inferences with confidence)
- Categorized macro news: presidential/policy, geopolitical/world, economic/Fed, defense

## OUTPUT — valid JSON only, no markdown wrapper.
Every value below MUST be a plain string (not an array or nested object). Use \\n for line breaks inside strings.

{
  "executive_summary": "string — 3-4 sentences max",
  "why_market": "string — 2-3 short paragraphs",
  "why_rotation": "string — 2-3 short paragraphs",
  "session_arc": "string — 1-2 paragraphs",
  "macro_context": "string — 2 paragraphs",
  "leaders_summary": "string — brief bullets as one string",
  "watch_list": [{"theme_name": "string", "reason": "string"}],
  "cautions": ["string"]
}

## CRITICAL RULES
1. Use exact theme names from input (e.g. "Consumer Staples", not "staples sector ETF")
2. Cite specific percentages and ranks from input — do not round aggressively
3. If macro news is thin, say so — do not fabricate geopolitical events
4. Distinguish correlation from causation for news links
5. If market is mixed, explain rotation over direction
6. Include defense/geopolitical context when risk_off or haven themes lead`;

export function buildBriefingSynthesisPrompt(
  dossier: ThemeBriefingDossier,
  ctx: BriefingStoryContext
): string {
  const compactThemes = dossier.themes.slice(0, 28).map((t) => ({
    name: t.name,
    rank: t.rank,
    score: t.score,
    medianPct: t.medianPct,
    rsVsBenchmark: t.rsVsBenchmark,
    breadthPct: t.breadthPct,
    deltaRankFromOpen: t.deltaRankFromOpen,
    deltaRankLate: t.deltaRankLate,
    narrow: t.isNarrowLeadership,
  }));

  const macroByCategory = {
    presidential: ctx.macroNews.filter((n) => n.category === "presidential").slice(0, 4),
    geopolitical: ctx.macroNews.filter((n) => n.category === "geopolitical").slice(0, 4),
    economic: ctx.macroNews.filter((n) => n.category === "economic").slice(0, 4),
    defense: ctx.macroNews.filter((n) => n.category === "defense").slice(0, 3),
    general: ctx.macroNews.filter((n) => n.category === "general").slice(0, 2),
  };

  return JSON.stringify(
    {
      mode: dossier.mode,
      referenceSession: dossier.referenceSession,
      priorSession: dossier.priorSession,
      marketDirection: ctx.marketDirection,
      directionLabel: ctx.directionLabel,
      rotationCharacter: dossier.rotationCharacter,
      benchmarks: dossier.benchmarks,
      storyAtoms: ctx.atoms.map((a) => ({
        category: a.category,
        headline: a.headline,
        detail: a.detail,
        confidence: a.confidence,
        evidence: a.evidence,
      })),
      themes: compactThemes.slice(0, 15),
      leaders: dossier.leaders.slice(0, 5).map((t) => t.name),
      laggards: dossier.laggards.slice(0, 5).map((t) => t.name),
      topMembers: dossier.topMembers.slice(0, 5),
      catalysts: dossier.catalysts.slice(0, 4),
      macroNews: macroByCategory,
      dataQuality: {
        warnings: dossier.dataQuality.warnings,
        intradaySlots: dossier.dataQuality.intradaySlots,
        openBaseline: dossier.dataQuality.openBaselineAvailable,
        lateBaseline: dossier.dataQuality.lateBaselineAvailable,
      },
    },
    null,
    0
  );
}
