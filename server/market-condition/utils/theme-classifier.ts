/**
 * Which theme does this ticker belong to, and do we actually know?
 *
 * Three answers are possible and the caller has to be able to tell them apart:
 * the ticker is a member of the theme, or its sector and industry point at one,
 * or a model was asked because nothing else did. Only the first is a fact. The
 * Theme tab shows the other two as a suggestion with an add button rather than
 * stating them, so the distinction has to survive the trip to the client.
 */

import OpenAI from "openai";
import {
  CLUSTERS,
  addRuntimeCandidate,
  autoMapTickerToCluster,
  getTickerStaticCluster,
  type ClusterId,
} from "../universe";
import { getThemesForSymbol } from "./theme-db-loader";

export type ThemeSource = "member" | "auto" | "llm";

export interface TickerThemeResolution {
  clusterId: ClusterId | null;
  /** Null only when nothing could place the ticker at all. */
  source: ThemeSource | null;
  /** What the guess was made from. Absent for real memberships. */
  basis?: string;
}

const CLASSIFIER_MODEL = "gpt-4.1-mini";

/**
 * Guesses already made, so a symbol is only ever classified once per boot.
 * Negative results are cached too: a ticker the model could not place will not
 * place any better on the next chart load, and asking again just costs a call.
 */
const inferred = new Map<string, TickerThemeResolution>();

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

function isKnownCluster(id: string): id is ClusterId {
  return CLUSTERS.some((c) => c.id === id);
}

/**
 * Ask a model which theme fits, given the catalogue it has to choose from.
 * Returns null on anything unexpected — a wrong theme presented confidently is
 * worse than the tab saying it does not know.
 */
async function classifyWithLlm(
  symbol: string,
  companyName: string | undefined,
  sector: string,
  industry: string
): Promise<ClusterId | null> {
  const openai = getOpenAI();
  if (!openai) return null;

  const catalogue = CLUSTERS.map((c) => `${c.id} — ${c.name}: ${c.notes ?? ""}`).join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: CLASSIFIER_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You assign a stock to one theme from a fixed list. Reply with JSON " +
            '{"themeId": "<id from the list>"} or {"themeId": null} when none of ' +
            "them genuinely fit. Never invent an id. Prefer null over a loose fit.",
        },
        {
          role: "user",
          content:
            `Themes:\n${catalogue}\n\n` +
            `Stock: ${symbol}\n` +
            `Company: ${companyName ?? "unknown"}\n` +
            `Sector: ${sector}\n` +
            `Industry: ${industry}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { themeId?: unknown };
    const id = typeof parsed.themeId === "string" ? parsed.themeId.toUpperCase() : null;
    return id && isKnownCluster(id) ? id : null;
  } catch (err) {
    console.warn(`[ThemeClassifier] ${symbol} LLM classify failed: ${String(err).slice(0, 120)}`);
    return null;
  }
}

export async function resolveTickerTheme(symbol: string): Promise<TickerThemeResolution> {
  const upper = symbol.toUpperCase();

  // The tickers table is the source of truth for membership, with the hardcoded
  // universe behind it for anything the database has not caught up on.
  const dbThemes = getThemesForSymbol(upper);
  if (dbThemes.length > 0 && isKnownCluster(dbThemes[0].id)) {
    return { clusterId: dbThemes[0].id, source: "member" };
  }

  const staticId = getTickerStaticCluster(upper);
  if (staticId) return { clusterId: staticId, source: "member" };

  const remembered = inferred.get(upper);
  if (remembered) return remembered;

  let sector = "Unknown";
  let industry = "Unknown";
  let companyName: string | undefined;
  try {
    const { getFundamentals } = await import("../../fundamentals");
    const fund = await getFundamentals(upper);
    sector = fund.sector || "Unknown";
    industry = fund.industry || "Unknown";
    companyName = fund.companyName;
  } catch {
    // No fundamentals is not fatal — the model can still work off the symbol.
  }

  if (sector !== "Unknown") {
    const autoCluster = autoMapTickerToCluster(upper, sector, industry);
    if (autoCluster) {
      const result: TickerThemeResolution = {
        clusterId: autoCluster,
        source: "auto",
        basis: industry !== "Unknown" ? industry : sector,
      };
      inferred.set(upper, result);
      addRuntimeCandidate(upper, autoCluster);
      console.log(`[ThemeClassifier] ${upper} → ${autoCluster} from ${result.basis}`);
      return result;
    }
  }

  const llmCluster = await classifyWithLlm(upper, companyName, sector, industry);
  const result: TickerThemeResolution = llmCluster
    ? { clusterId: llmCluster, source: "llm", basis: "model" }
    : { clusterId: null, source: null };

  inferred.set(upper, result);
  if (llmCluster) {
    addRuntimeCandidate(upper, llmCluster);
    console.log(`[ThemeClassifier] ${upper} → ${llmCluster} from model`);
  }
  return result;
}

/** Drop a remembered guess once the ticker has been given a real theme. */
export function forgetInferredTheme(symbol: string): void {
  inferred.delete(symbol.toUpperCase());
}
