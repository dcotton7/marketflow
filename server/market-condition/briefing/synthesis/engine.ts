/**
 * Theme Review AI synthesis — GPT-5.1 narrative from dossier + rule-derived story atoms.
 */

import OpenAI from "openai";
import type {
  BriefingNarrative,
  BriefingStoryContext,
  ThemeBriefingDossier,
} from "../types";
import { buildRulesNarrative } from "../narrative-rules";
import { BRIEFING_SYNTHESIS_SYSTEM_PROMPT, buildBriefingSynthesisPrompt } from "./prompt";

export const BRIEFING_SYNTHESIS_MODEL = "gpt-5.1";

function getOpenAI(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  return new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

interface LlmBriefingOutput {
  executive_summary?: unknown;
  why_market?: unknown;
  why_rotation?: unknown;
  session_arc?: unknown;
  macro_context?: unknown;
  leaders_summary?: unknown;
  watch_list?: Array<{ theme_name?: string; reason?: string }>;
  cautions?: unknown;
}

/** LLM JSON occasionally returns arrays/objects for text fields — coerce to string. */
function asBriefingText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return asBriefingText((item as { text: unknown }).text);
        }
        if (item && typeof item === "object" && "headline" in item) {
          return asBriefingText((item as { headline: unknown }).headline);
        }
        return asBriefingText(item);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${asBriefingText(v)}`)
      .join("\n");
  }
  return String(value);
}

function mapLlmToNarrative(
  parsed: LlmBriefingOutput,
  dossier: ThemeBriefingDossier,
  ctx: BriefingStoryContext
): BriefingNarrative {
  const rulesFallback = buildRulesNarrative(dossier, ctx);
  const themeNameToId = new Map(dossier.themes.map((t) => [t.name.toLowerCase(), t.id]));

  const watchList =
    parsed.watch_list?.length > 0
      ? parsed.watch_list.slice(0, 6).map((w) => ({
          themeId:
            themeNameToId.get(String(w.theme_name ?? "").toLowerCase()) ??
            String(w.theme_name ?? "unknown"),
          themeName: String(w.theme_name ?? "Unknown"),
          reason: asBriefingText(w.reason),
        }))
      : rulesFallback.watchList;

  const sections: BriefingNarrative["sections"] = [
    { id: "why_market", title: "Why the market moved", body: asBriefingText(parsed.why_market) },
    { id: "why_rotation", title: "Why this rotation", body: asBriefingText(parsed.why_rotation) },
    {
      id: "session_arc",
      title: "Session arc (open → late → close)",
      body: asBriefingText(parsed.session_arc),
    },
    { id: "macro_context", title: "Macro & news context", body: asBriefingText(parsed.macro_context) },
    { id: "leaders", title: "Theme leaders", body: asBriefingText(parsed.leaders_summary) },
  ];

  const cautions = Array.isArray(parsed.cautions)
    ? parsed.cautions.map((c) => asBriefingText(c)).filter(Boolean)
    : asBriefingText(parsed.cautions)
        .split("\n")
        .map((c) => c.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean);

  if (cautions.length) {
    sections.push({
      id: "caution",
      title: "Caution flags",
      body: cautions.map((c) => `• ${c}`).join("\n"),
    });
  }

  sections.push(
    rulesFallback.sections.find((s) => s.id === "data_quality") ?? {
      id: "data_quality",
      title: "Data limitations",
      body: dossier.dataQuality.warnings.join("\n"),
    }
  );

  return {
    executiveSummary:
      asBriefingText(parsed.executive_summary) || rulesFallback.executiveSummary,
    sections,
    watchList,
    source: "llm",
  };
}

function tryParseBriefingJson(content: string): LlmBriefingOutput | null {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as LlmBriefingOutput;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as LlmBriefingOutput;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callBriefingLlm(
  openai: OpenAI,
  userPrompt: string
): Promise<LlmBriefingOutput | null> {
  const response = await openai.chat.completions.create({
    model: BRIEFING_SYNTHESIS_MODEL,
    messages: [
      { role: "system", content: BRIEFING_SYNTHESIS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 3500,
    temperature: 0.5,
  });

  const content = response.choices[0]?.message?.content || "";
  return tryParseBriefingJson(content);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function synthesizeBriefingNarrative(
  dossier: ThemeBriefingDossier,
  ctx: BriefingStoryContext
): Promise<{ narrative: BriefingNarrative; model: string } | null> {
  const openai = getOpenAI();
  if (!openai) return null;

  const userPrompt = buildBriefingSynthesisPrompt(dossier, ctx);

  console.log(
    `[Briefing-Synthesis] Calling ${BRIEFING_SYNTHESIS_MODEL} for ${dossier.referenceSession} (${ctx.atoms.length} atoms)`
  );

  try {
    const parsed = await withTimeout(
      (async () => {
        let result = await callBriefingLlm(openai, userPrompt);
        if (!result) {
          console.warn("[Briefing-Synthesis] JSON parse failed, retrying compact");
          result = await callBriefingLlm(
            openai,
            userPrompt.slice(0, 10000) +
              "\n\nRespond with minimal JSON. Keep every string under 500 characters."
          );
        }
        return result;
      })(),
      55_000
    );

    if (!parsed) {
      console.warn("[Briefing-Synthesis] Timed out or empty — using rules narrative");
      return null;
    }

    return {
      narrative: mapLlmToNarrative(parsed, dossier, ctx),
      model: BRIEFING_SYNTHESIS_MODEL,
    };
  } catch (error) {
    console.error("[Briefing-Synthesis] Failed:", error);
    return null;
  }
}
