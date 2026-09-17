/**
 * Per-request broker table extract. Image is not stored.
 * Missing cells stay null. P/L is not persisted (it goes stale immediately).
 */

import OpenAI from "openai";
import { normalizeTosScreenExtract, type TosScreenExtractResult } from "@shared/tos-screen-extract";

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL });
}

export function isTosScreenExtractAvailable(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

const SYSTEM = `You extract stock rows from a brokerage positions / watchlist table in a screenshot.

Supported layouts (pick one):
- tos_watchlist / tos_positions: Thinkorswim desktop. Columns: Symbol, Avg Cost, Pos Qty, P/L, Last.
- fidelity_positions: Fidelity / NetBenefits / BrokerageLink Positions. Columns: Symbol, Last price, Average cost basis, Quantity, Cost basis total, gain/loss columns.
- ticker_list: only symbols are readable.
- unknown: cannot tell.

Fidelity rules:
- avgCost = "Average cost basis" (per-share). NEVER use "Cost basis total", Current value, or any gain/loss column.
- posQty = Quantity. lastPrice = Last price.
- Skip Cash, Core / money-market, Funding activity, Account total, account-name header rows, and company-name lines under the ticker.
- Example: AMD last 151.91, average cost basis 92.22, quantity 100.01 → avgCost 92.22, posQty 100.01, lastPrice 151.91, hasPosition true.

Thinkorswim rules:
- avgCost = Avg Cost (cost basis), not P/L. Pos Qty like "+150" is 150.
- Yellow numbered badges and person icons are not tickers.

Shared rules:
- Read symbols only from the Symbol column.
- A dash, blank, or "N/A" is null. Never invent a number.
- Do not leave avgCost null if that cost-basis cell shows a price.
- hasPosition is true when quantity is a non-zero number.
- P/L columns must not appear in the JSON.

Return JSON only:
{
  "layout": "tos_watchlist" | "tos_positions" | "fidelity_positions" | "ticker_list" | "unknown",
  "positions": [
    {
      "symbol": "AAPL",
      "avgCost": 181.77,
      "posQty": 250,
      "lastPrice": 179.135,
      "hasPosition": true
    }
  ]
}`;

export async function extractTosScreen(imageDataUrl: string): Promise<TosScreenExtractResult> {
  const openai = getOpenAI();
  if (!openai) {
    throw new Error("Screen extract is not configured on this host");
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2500,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract every equity symbol row. Use per-share average cost / Avg Cost, not the account total cost basis. Unknown values must be null.",
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Could not parse the table from this image");
  }
  return normalizeTosScreenExtract(parsed);
}
