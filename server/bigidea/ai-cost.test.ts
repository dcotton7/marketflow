/**
 * AI cost log: fixed estimates, and the size of the indicator library the create/refine/restate prompts send
 * (built exactly as the routes build it), with and without the retired indicators.
 */
import assert from "node:assert/strict";
import { aiCostLine, estimateAiCost, promptChars } from "./ai-cost";
import { INDICATOR_LIBRARY, activeIndicators } from "./indicators";

// 28,000 input + 500 output tokens of gpt-4o at the assumed $2.50 / $10 per million = $0.075
assert.deepEqual(estimateAiCost({ route: "r", model: "gpt-4o", userId: 1, promptChars: 1, usage: { prompt_tokens: 28000, completion_tokens: 500 } }),
  { inputTokens: 28000, outputTokens: 500, usd: 0.075, estimatedTokens: false });
assert.equal(estimateAiCost({ route: "r", model: "gpt-4o", userId: 1, promptChars: 4000 }).inputTokens, 1000, "chars / 4 without usage");
assert.equal(estimateAiCost({ route: "r", model: "other", userId: 1, promptChars: 4 }).usd, null);
assert.match(aiCostLine({ route: "ai/create-thought", model: "gpt-4o", userId: 7, promptChars: 112000, usage: { prompt_tokens: 28000, completion_tokens: 500 } }),
  /^\[BigIdea AI cost\] ai\/create-thought model=gpt-4o user=7 prompt=112000 chars in=28000 out=500 tokens ~\$0\.0750$/);
assert.equal(promptChars([{ content: "abc" }, { content: "de" }]), 5);

const summary = (lib: typeof INDICATOR_LIBRARY) => JSON.stringify(lib.map((ind) => ({
  id: ind.id, name: ind.name, category: ind.category, description: ind.description, provides: ind.provides, consumes: ind.consumes,
  params: ind.params.map((p) => ({ name: p.name, label: p.label, type: p.type, defaultValue: p.defaultValue, options: p.options, min: p.min, max: p.max, step: p.step })),
})), null, 2);
const all = summary(INDICATOR_LIBRARY).length;
const active = summary(activeIndicators(INDICATOR_LIBRARY)).length;
assert.ok(active < all);
console.log(`library JSON sent to the model: ${all} chars with every indicator, ${active} without ITD-1/ITD-2 (${all - active} fewer)`);
console.log("ai-cost: all checks passed");
