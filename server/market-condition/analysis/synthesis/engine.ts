/**
 * MarketFlow AI Synthesis Engine
 * Calls OpenAI to generate narrative from module responses
 */

import OpenAI from "openai";
import type { ModuleResponse, SynthesisOutput } from "../types";
import { SYNTHESIS_SYSTEM_PROMPT, buildSynthesisPrompt } from "./prompt";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MODEL = "gpt-4o"; // or gpt-5.1 if available

export async function runSynthesis(
  symbol: string,
  modules: ModuleResponse[]
): Promise<SynthesisOutput> {
  const userPrompt = buildSynthesisPrompt(symbol, modules);

  console.log(`[Synthesis] Calling AI for ${symbol} with ${modules.length} modules`);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.7,
    } as any);

    const content = response.choices[0]?.message?.content || "{}";
    const usage = response.usage;

    console.log(`[Synthesis] Tokens: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}`);

    const parsed = JSON.parse(content);

    // Validate and normalize the response
    return {
      company_description: parsed.company_description || "",
      executive_summary: parsed.executive_summary || `Analysis complete for ${symbol}.`,
      conviction_score: normalizeScore(parsed.conviction_score),
      action: normalizeAction(parsed.action),
      action_rationale: parsed.action_rationale || "",
      key_bullish: Array.isArray(parsed.key_bullish) ? parsed.key_bullish.slice(0, 5) : [],
      key_bearish: Array.isArray(parsed.key_bearish) ? parsed.key_bearish.slice(0, 5) : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      rubric_autofill: extractRubricAutofill(modules),
      model_used: MODEL,
    };
  } catch (error) {
    console.error(`[Synthesis] AI call failed:`, error);
    throw error;
  }
}

function normalizeScore(score: unknown): number {
  if (typeof score === "number") {
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  return 50;
}

function normalizeAction(action: unknown): SynthesisOutput["action"] {
  const valid = ["strong_buy", "buy", "watch", "avoid", "short"];
  if (typeof action === "string" && valid.includes(action)) {
    return action as SynthesisOutput["action"];
  }
  return "watch";
}

function extractRubricAutofill(modules: ModuleResponse[]): Record<string, unknown> {
  const setup = modules.find((m) => m.module_id === "setupDetection");
  if (setup?.data && typeof setup.data === "object" && "rubricAutofill" in setup.data) {
    return (setup.data as { rubricAutofill: Record<string, unknown> }).rubricAutofill;
  }
  return {};
}
