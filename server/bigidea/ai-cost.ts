/**
 * One log line per BigIdea AI call: route, model, prompt size and an estimated cost (Don, 26 Nov 2026: no caps yet,
 * "I am only user atm"; this is so the cost is visible). Prices are estimates in US dollars per million tokens and
 * are not read from the provider; when the reply carries token usage, that is used, otherwise characters / 4.
 */
export const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
};

export interface AiCallSize {
  route: string;
  model: string;
  userId: number | null;
  promptChars: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export function estimateAiCost(size: AiCallSize): { inputTokens: number; outputTokens: number; usd: number | null; estimatedTokens: boolean } {
  const inputTokens = size.usage?.prompt_tokens ?? Math.ceil(size.promptChars / 4);
  const outputTokens = size.usage?.completion_tokens ?? 0;
  const price = PRICE_PER_MILLION[size.model];
  const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;
  return { inputTokens, outputTokens, usd, estimatedTokens: size.usage?.prompt_tokens == null };
}

export function aiCostLine(size: AiCallSize): string {
  const c = estimateAiCost(size);
  const cost = c.usd == null ? "cost unknown" : `~$${c.usd.toFixed(4)}`;
  return `[BigIdea AI cost] ${size.route} model=${size.model} user=${size.userId ?? "?"} prompt=${size.promptChars} chars ` +
    `in=${c.inputTokens}${c.estimatedTokens ? " (est.)" : ""} out=${c.outputTokens} tokens ${cost}`;
}

export function logAiCall(size: AiCallSize): void {
  console.log(aiCostLine(size));
}

/** Total characters of a chat request's messages. */
export function promptChars(messages: Array<{ content?: unknown }>): number {
  return messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length), 0);
}
