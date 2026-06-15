/**
 * On-demand chart setup enrich — structured dossier + optional similar models + LLM/rules.
 */

import OpenAI from "openai";
import type {
  ChartEnrichLifecycleStage,
  ChartEnrichPatternCleanliness,
  ChartEnrichPatternLabel,
  ChartSetupEnrichDossier,
  ChartSetupEnrichResult,
} from "@shared/chart-setup-enrich";
import {
  CHART_ENRICH_LIFECYCLE_DISPLAY,
  CHART_ENRICH_LIFECYCLE_STAGES,
  CHART_ENRICH_PATTERN_CLEANLINESS,
  CHART_ENRICH_PATTERN_LABELS,
} from "@shared/chart-setup-enrich";
import {
  CHART_SETUP_POSTURE_LABELS,
  type ChartSetupStructureMeta,
} from "@shared/chart-setup-structure-meta";

export const CHART_SETUP_ENRICH_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `You are a disciplined swing-trading analyst reviewing a live chart setup.
Use ONLY facts from the dossier and similar corrected models. Structured lifecycle facts override visual guesses.
Write in plain trader voice: 2-4 sentences for recommendation, one line for invalidation.
All percentages must use exactly two decimal places (e.g. 73.70%).
If price is already extended after a U&R rally, say post-rally/extended — do NOT say "wait for recapture" unless dossier shows price still below key MAs.

Structure rules (dossier.structureMeta when present):
- Declining / downsloping MAs (20, 50, 200) are NEGATIVES for long / swing-long setups — call them out explicitly.
- Price below the 200-day SMA is a NEGATIVE for long setups unless U&R reclaim is clearly in play (scan fired O5).
- When postureHint is short_watch or shortSetupIdeas are present, weave in possible short / avoid-long ideas (failed bounce, breakdown continuation, weak-theme laggard fade). Frame as watch-level thesis, not a blind short command.
- When themeBreakdown shows breakdown_watch or avoid_long, tie stock weakness to theme breakdown when relevant.

Base rules (dossier.baseMeta when present):
- When baseMeta.detected is true, the FIRST sentence of recommendation MUST explicitly mention the long base / consolidation (use the word "base").
- Treat the gap-forward long base as a PRIMARY positive — before U&R, tight MAs, or RS commentary.
- Call out gap date, base length (days), range depth %, pivot ceiling, and whether price is still inside the base or has broken out (triggered).
- A multi-week base after a gap-up (e.g. Apr gap → consolidation forward) is a classic long-setup structure — never omit it when baseMeta.detected is true.
- Prefer the RECENT tight coil (often 20–50d since mid-chart) over stale gap anchors from months ago. If copy says "since January" but a tighter April/May base is visible, lead with the recent coil.
- When price is above 20d/50d/200d, do not call the base a "repair zone below 200d" — that is wrong for healthy stacks.
- When baseMeta.baseBelow200d is true, say clearly the base formed UNDER the 200d (repair zone) — not a leadership base during the coil.
- When baseMeta.reclaim200d.justOnLastBar or baseMeta.powerSetup is true, the LAST daily bar reclaiming the 200d is the key signal — lead with it. Power = underlying base below 200d + fresh 200d reclaim. Do not bury this under generic U&R or tight MA talk.

U&R rules (dossier.urMeta when present):
- When urMeta.buyableNow is true (especially reclaimOnLastBar on 20 SMA), this is the PRIMARY actionable setup — say it is a textbook undercut-and-rally entry NOW, not "coiling" or "wait for recapture."
- Name the MA (e.g. 20 SMA U&R), the short pullback undercut, and that the last bar reclaimed — buyable as U&R.
- When both baseMeta and urMeta.buyableNow are true, base is context; U&R timing is the trade trigger. Do not replace U&R with generic tight-MA commentary.
- patternLabel should be undercut_rally when urMeta.buyableNow is true.
- NEVER say "pattern is unclear" or "no distinct base" when urMeta.buyableNow is true — that is wrong; call it a clean U&R.
- If urMeta mentions a topping wick / follow-through TBD, include it — U&R is live but the last bar's wick means confirmation is not done yet.

Return valid JSON only.`;

function getOpenAI(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function structureMetaFromDossier(dossier: ChartSetupEnrichDossier): ChartSetupStructureMeta | null {
  return dossier.structureMeta ?? null;
}

const UR_VAGUE_CONTRADICTIONS = [
  /pattern is unclear[^.]*\.?\s*/gi,
  /no distinct base or breakout pattern[^.]*\.?\s*/gi,
  /no distinct base[^.]*\.?\s*/gi,
  /tight moving averages[^.]*coiling[^.]*\.?\s*/gi,
  /coiling for a potential directional[^.]*\.?\s*/gi,
];

function stripUrContradictions(text: string): string {
  let out = text;
  for (const re of UR_VAGUE_CONTRADICTIONS) {
    out = out.replace(re, "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\.\s*\./g, ".").trim();
}

function ensureUrInRecommendation(
  result: ChartSetupEnrichResult,
  dossier: ChartSetupEnrichDossier
): ChartSetupEnrichResult {
  const u = dossier.urMeta;
  if (!u?.detected || !u.summaryLines.length) return result;

  const m = dossier.metrics as { rsVsSpy?: number } | null | undefined;
  const rs =
    typeof m?.rsVsSpy === "number"
      ? ` RS vs SPY ${m.rsVsSpy >= 0 ? "+" : ""}${m.rsVsSpy.toFixed(2)}%.`
      : "";

  let recommendation = stripUrContradictions(result.recommendation);
  const lower = recommendation.toLowerCase();
  const mentionsUr =
    lower.includes("u&r") || lower.includes("undercut") || lower.includes("undercut-and-rally");

  if (u.buyableNow && u.summaryLines[0]) {
    const contradicts =
      /unclear|no distinct|coiling for a potential|tight moving averages.*coiling/i.test(
        recommendation
      );
    if (contradicts || !mentionsUr) {
      recommendation = `${u.summaryLines[0]}. Textbook ${u.maLabel ?? "MA"} undercut-and-rally after a short pullback — buyable on today's reclaim.${rs}`;
    } else if (!recommendation.startsWith(u.summaryLines[0].slice(0, 12))) {
      recommendation = `${u.summaryLines[0]}. ${recommendation}`;
    }
  } else if (!mentionsUr && u.summaryLines[0]) {
    recommendation = `${u.summaryLines[0]}. ${recommendation}`;
  }

  let lifecycle = result.lifecycleStage;
  let patternLabel = result.patternLabel;
  let patternCleanliness = result.patternCleanliness;
  let patternConfidencePct = result.patternConfidencePct;
  let invalidation = result.invalidation;

  if (u.buyableNow) {
    lifecycle = "triggering";
    patternLabel = "undercut_rally";
    patternCleanliness = "clean";
    patternConfidencePct = u.confidence ?? patternConfidencePct;
    if (u.undercutLow != null && u.maLabel) {
      invalidation = `Lose ${u.maLabel} on volume — undercut low near $${u.undercutLow.toFixed(2)}.`;
    }
  } else if (u.detected && patternLabel === "none_unclear") {
    patternLabel = "undercut_rally";
    patternConfidencePct = u.confidence ?? patternConfidencePct;
  }

  return {
    ...result,
    recommendation,
    lifecycleStage: lifecycle,
    patternLabel,
    patternCleanliness,
    patternConfidencePct,
    invalidation,
    ...(u.detected ? { urMeta: u } : {}),
  };
}

function ensureBaseInRecommendation(
  result: ChartSetupEnrichResult,
  dossier: ChartSetupEnrichDossier
): ChartSetupEnrichResult {
  const b = dossier.baseMeta;
  const u = dossier.urMeta;
  if (!b?.detected || !b.summaryLines.length) return result;

  const lower = result.recommendation.toLowerCase();
  const mentionsBase = lower.includes("base") || lower.includes("consolidation");
  const mentions200 =
    lower.includes("200") || lower.includes("reclaim") || lower.includes("repair");

  let recommendation = result.recommendation;
  if (b.powerSetup && b.summaryLines.length > 0) {
    const powerLine =
      b.summaryLines.find((l) => l.startsWith("Power setup:")) ?? b.summaryLines[0];
    if (!recommendation.includes(powerLine.slice(0, 24))) {
      recommendation = `${powerLine}. ${recommendation}`;
    }
  } else if (!mentionsBase) {
    recommendation = `${b.summaryLines[0]}. ${recommendation}`;
  } else if (b.reclaim200d?.justOnLastBar && !mentions200) {
    const reclaimLine = b.summaryLines.find((l) => l.includes("reclaims the 200d"));
    if (reclaimLine) recommendation = `${reclaimLine}. ${recommendation}`;
  }

  const withRec = { ...result, recommendation };

  const lifecycle =
    u?.buyableNow
      ? ("triggering" as ChartEnrichLifecycleStage)
      : b.powerSetup || b.reclaim200d?.justOnLastBar
        ? ("triggering" as ChartEnrichLifecycleStage)
        : b.stage === "triggered" || b.stage === "ready"
          ? ("triggering" as ChartEnrichLifecycleStage)
          : b.stage === "extended"
            ? ("post_rally" as ChartEnrichLifecycleStage)
            : withRec.lifecycleStage;

  const patternLabel = u?.buyableNow
    ? ("undercut_rally" as ChartEnrichPatternLabel)
    : withRec.patternLabel === "none_unclear" && b.detected
      ? ("pullback" as ChartEnrichPatternLabel)
      : withRec.patternLabel;

  return { ...withRec, lifecycleStage: lifecycle, patternLabel };
}

function attachDossierMeta(
  result: ChartSetupEnrichResult,
  dossier: ChartSetupEnrichDossier
): ChartSetupEnrichResult {
  let merged: ChartSetupEnrichResult = {
    ...result,
    ...(dossier.structureMeta ? { structureMeta: dossier.structureMeta } : {}),
    ...(dossier.baseMeta?.detected ? { baseMeta: dossier.baseMeta } : {}),
    ...(dossier.urMeta?.detected ? { urMeta: dossier.urMeta } : {}),
  };
  merged = ensureBaseInRecommendation(merged, dossier);
  merged = ensureUrInRecommendation(merged, dossier);
  return merged;
}

function buildRulesResult(dossier: ChartSetupEnrichDossier): ChartSetupEnrichResult {
  const sym = dossier.symbol.toUpperCase();
  const m = dossier.metrics as Record<string, unknown> | null | undefined;
  const meta = structureMetaFromDossier(dossier);
  const ext50 =
    typeof m?.extensionFrom50dPct === "number" ? m.extensionFrom50dPct : null;
  const rs =
    typeof m?.rsVsSpy === "number" ? m.rsVsSpy : null;

  const baseMeta = dossier.baseMeta;

  const urMeta = dossier.urMeta;

  let lifecycle: ChartEnrichLifecycleStage = "unclear";
  if (urMeta?.buyableNow) {
    lifecycle = "triggering";
  } else if (baseMeta?.powerSetup || baseMeta?.reclaim200d?.justOnLastBar) {
    lifecycle = "triggering";
  } else if (baseMeta?.detected) {
    if (baseMeta.stage === "triggered" || baseMeta.stage === "ready") lifecycle = "triggering";
    else if (baseMeta.stage === "extended") lifecycle = "post_rally";
    else lifecycle = "pre_setup";
  } else if (meta?.postureHint === "short_watch" || meta?.postureHint === "repair_only") {
    lifecycle = "watch_pullback";
  } else if (ext50 != null && ext50 > 8) lifecycle = "extended";
  else if (ext50 != null && ext50 > 3) lifecycle = "post_rally";
  else lifecycle = "pre_setup";
  const scan = dossier.scanRow as { firedOptional?: string[] } | null | undefined;
  let pattern: ChartEnrichPatternLabel = "none_unclear";
  if (urMeta?.buyableNow) pattern = "undercut_rally";
  else if (urMeta?.detected) pattern = "undercut_rally";
  else if (baseMeta?.detected) pattern = "pullback";
  else if (scan?.firedOptional?.includes("O5")) pattern = "undercut_rally";
  else if (scan?.firedOptional?.includes("O6")) pattern = "vcp";
  else if (scan?.firedOptional?.includes("O8") || scan?.firedOptional?.includes("O10"))
    pattern = "breakout";

  const rsBit =
    rs != null ? ` RS vs SPY ${rs >= 0 ? "+" : ""}${rs.toFixed(2)}%.` : "";
  const extBit =
    ext50 != null ? ` Structure ${ext50 >= 0 ? "+" : ""}${ext50.toFixed(2)}% vs 50d.` : "";

  const negBit =
    meta?.longSetupNegatives?.length
      ? ` Long headwinds: ${meta.longSetupNegatives.slice(0, 2).join("; ")}.`
      : "";
  const postureBit = meta?.postureHint
    ? ` ${CHART_SETUP_POSTURE_LABELS[meta.postureHint]}.`
    : "";
  const shortBit =
    meta?.shortSetupIdeas?.length
      ? ` Short-watch: ${meta.shortSetupIdeas[0]}`
      : "";
  const core = `${sym}: ${CHART_ENRICH_LIFECYCLE_DISPLAY[lifecycle]} — review chart structure before sizing.${postureBit}${negBit}${rsBit}${extBit}${shortBit}`;
  const urLead = urMeta?.buyableNow && urMeta.summaryLines[0] ? `${urMeta.summaryLines[0]}. ` : "";
  const baseLead =
    !urLead && baseMeta?.summaryLines?.[0] ? `${baseMeta.summaryLines[0]}. ` : "";

  return attachDossierMeta(
    {
      recommendation: `${urLead}${baseLead}${core}`,
      invalidation:
        urMeta?.buyableNow && urMeta.undercutLow != null && urMeta.maLabel
          ? `Lose ${urMeta.maLabel} on volume — undercut low near $${urMeta.undercutLow.toFixed(2)}.`
          : baseMeta?.floor != null
            ? `Lose base floor near $${baseMeta.floor.toFixed(2)} on volume.`
            : meta?.postureHint === "short_watch"
              ? "Reclaim 50d/200d on volume — breakdown thesis wrong."
              : "Lose key MAs / pivot low on volume.",
      lifecycleStage: lifecycle,
      patternLabel: pattern,
      patternCleanliness: urMeta?.buyableNow || baseMeta?.detected ? "clean" : "unclear",
      patternConfidencePct: urMeta?.confidence ?? baseMeta?.confidence ?? null,
      source: "rules",
    },
    dossier
  );
}

function parseResult(raw: Record<string, unknown>): ChartSetupEnrichResult | null {
  const recommendation = String(raw.recommendation ?? raw.decisionBrief ?? "").trim();
  if (!recommendation) return null;

  const lifecycle = CHART_ENRICH_LIFECYCLE_STAGES.includes(
    raw.lifecycleStage as ChartEnrichLifecycleStage
  )
    ? (raw.lifecycleStage as ChartEnrichLifecycleStage)
    : "unclear";

  const pattern = CHART_ENRICH_PATTERN_LABELS.includes(
    raw.patternLabel as ChartEnrichPatternLabel
  )
    ? (raw.patternLabel as ChartEnrichPatternLabel)
    : "none_unclear";

  const cleanliness = CHART_ENRICH_PATTERN_CLEANLINESS.includes(
    raw.patternCleanliness as ChartEnrichPatternCleanliness
  )
    ? (raw.patternCleanliness as ChartEnrichPatternCleanliness)
    : "unclear";

  const confRaw = raw.patternConfidencePct;
  const patternConfidencePct =
    confRaw != null && Number.isFinite(Number(confRaw)) ? round2(Number(confRaw)) : null;

  return {
    recommendation,
    invalidation: String(raw.invalidation ?? "Lose setup pivot on volume.").trim(),
    lifecycleStage: lifecycle,
    patternLabel: pattern,
    patternCleanliness: cleanliness,
    patternConfidencePct,
    source: "llm",
  };
}

export function buildEnrichUserPrompt(
  dossier: ChartSetupEnrichDossier,
  similarModels: { symbol: string; tier: string; note: string | null; result: ChartSetupEnrichResult }[]
): string {
  const similarBlock =
    similarModels.length > 0
      ? `\nSimilar corrected models (learn from these, do not copy verbatim):\n${JSON.stringify(
          similarModels.map((m) => ({
            symbol: m.symbol,
            tier: m.tier,
            note: m.note,
            lifecycle: m.result.lifecycleStage,
            pattern: m.result.patternLabel,
            recommendation: m.result.recommendation.slice(0, 280),
          })),
          null,
          2
        )}`
      : "";

  const b = dossier.baseMeta;
  const u = dossier.urMeta;
  const urLead =
    u?.buyableNow && u.summaryLines[0]
      ? `\nIMPORTANT: urMeta.buyableNow=true. Lead with: "${u.summaryLines[0]}" — this is an actionable ${u.maLabel ?? "MA"} U&R NOW, not a coil/wait setup.\n`
      : u?.detected && u.summaryLines[0]
        ? `\nIMPORTANT: urMeta detected. Mention: "${u.summaryLines[0]}"\n`
        : "";
  const baseLead = b?.detected
    ? b.powerSetup
      ? `\nIMPORTANT: powerSetup=true (base below 200d + last bar reclaims 200d). Open with: "${b.summaryLines.find((l) => l.startsWith("Power setup:")) ?? b.summaryLines[0]}"\n`
      : b.summaryLines[0]
        ? `\nIMPORTANT: baseMeta.detected=true. Open recommendation with: "${b.summaryLines[0]}"${
            b.reclaim200d?.justOnLastBar
              ? ` Then emphasize last-bar 200d reclaim: "${b.summaryLines.find((l) => l.includes("reclaims the 200d")) ?? ""}"`
              : ""
          }\n`
        : ""
    : "";

  return `Analyze ${dossier.symbol.toUpperCase()} for setup posture and pattern.
${urLead}${baseLead}
Return JSON:
{
  "recommendation": "2-4 sentences — lifecycle first, then pattern quality, then actionable posture",
  "invalidation": "one line",
  "lifecycleStage": one of ${JSON.stringify(CHART_ENRICH_LIFECYCLE_STAGES)},
  "patternLabel": one of ${JSON.stringify(CHART_ENRICH_PATTERN_LABELS)},
  "patternCleanliness": one of ${JSON.stringify(CHART_ENRICH_PATTERN_CLEANLINESS)},
  "patternConfidencePct": number 0-100 with two decimals or null
}

Dossier:
${JSON.stringify(
  {
    symbol: dossier.symbol,
    intradayTimeframe: dossier.intradayTimeframe,
    dailyBars: dossier.dailyBars,
    intradayBars: dossier.intradayBars,
    metrics: dossier.metrics,
    scanRow: dossier.scanRow,
    themeId: dossier.themeId,
    themeRank: dossier.themeRank,
    structureMeta: dossier.structureMeta,
    baseMeta: dossier.baseMeta,
    urMeta: dossier.urMeta,
  },
  null,
  2
)}${similarBlock}`;
}

export async function runChartSetupEnrich(
  dossier: ChartSetupEnrichDossier,
  similarModels: { symbol: string; tier: string; note: string | null; result: ChartSetupEnrichResult }[] = []
): Promise<ChartSetupEnrichResult> {
  const openai = getOpenAI();
  if (!openai) return buildRulesResult(dossier);

  try {
    const completion = await openai.chat.completions.create({
      model: CHART_SETUP_ENRICH_MODEL,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildEnrichUserPrompt(dossier, similarModels) },
      ],
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<
      string,
      unknown
    >;
    const parsed = parseResult(raw);
    return parsed ? attachDossierMeta(parsed, dossier) : buildRulesResult(dossier);
  } catch (err) {
    console.warn("[ChartSetupEnrich] LLM failed, rules fallback:", err);
    return buildRulesResult(dossier);
  }
}
