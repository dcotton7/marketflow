/**
 * Ticker Review batch LLM enrich — decision brief + invalidation per starred symbol.
 */

import OpenAI from "openai";
import type { TickerReviewResultRow } from "@shared/ticker-review-engine";
import {
  TICKER_REVIEW_ENRICH_SYSTEM_PROMPT,
  buildTickerReviewEnrichPrompt,
  type EnrichDossierItem,
} from "./prompt";

export const TICKER_REVIEW_ENRICH_MODEL = "gpt-4.1-mini";

export interface TickerReviewEnrichResult {
  symbol: string;
  decisionBrief: string;
  invalidation: string;
  source: "llm" | "rules";
}

function getOpenAI(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

function buildRulesEnrich(row: TickerReviewResultRow, themeRank?: number): TickerReviewEnrichResult {
  const sym = row.symbol.toUpperCase();
  const ext200 = row.structure.pctVs200;
  const ext50 = row.structure.pctVs50;
  const rs = row.rs.vsSpy;

  const risks: string[] = [];
  if (ext200 != null && ext200 < 0) risks.push(`below 200d (${ext200.toFixed(1)}%)`);
  if (ext50 != null && ext50 > 8) risks.push(`extended vs 50d (+${ext50.toFixed(1)}%)`);
  if (rs < 0) risks.push(`lagging SPY (${rs.toFixed(1)}%)`);

  const worth =
    row.bucket === "setup_ready" || row.bucket === "activating"
      ? "Setup looks actionable"
      : row.bucket === "setup_forming"
        ? "Forming — watch for trigger"
        : "Monitor only";

  const themeCtx = themeRank != null ? ` Theme #${themeRank}.` : "";
  const riskText = risks.length ? ` Key risks: ${risks.join("; ")}.` : "";

  return {
    symbol: sym,
    decisionBrief: `${worth} — ${row.setupNarrative.slice(0, 200)}${themeCtx}${riskText}`,
    invalidation: ext200 != null && ext200 < -5
      ? "Break below 200d with volume — repair thesis fails."
      : "Lose key MAs / undercut pivot low on volume.",
    source: "rules",
  };
}

export async function enrichTickerReviewBatch(
  items: EnrichDossierItem[]
): Promise<TickerReviewEnrichResult[]> {
  if (!items.length) return [];

  const openai = getOpenAI();
  if (!openai) {
    return items.map((item) =>
      buildRulesEnrich(item.row, item.themeRank)
    );
  }

  try {
    const completion = await openai.chat.completions.create({
      model: TICKER_REVIEW_ENRICH_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TICKER_REVIEW_ENRICH_SYSTEM_PROMPT },
        { role: "user", content: buildTickerReviewEnrichPrompt(items) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      symbols?: Record<string, { decisionBrief?: string; invalidation?: string }>;
    };

    return items.map((item) => {
      const sym = item.symbol.toUpperCase();
      const hit = parsed.symbols?.[sym];
      if (hit?.decisionBrief) {
        return {
          symbol: sym,
          decisionBrief: String(hit.decisionBrief),
          invalidation: String(hit.invalidation ?? "Lose setup pivot on volume."),
          source: "llm" as const,
        };
      }
      return buildRulesEnrich(item.row, item.themeRank);
    });
  } catch (err) {
    console.warn("[TickerReviewEnrich] LLM failed, using rules:", err);
    return items.map((item) => buildRulesEnrich(item.row, item.themeRank));
  }
}
