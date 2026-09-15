/**
 * Per-request Thinkorswim table extract. Image is not stored.
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

const SYSTEM = `You extract data from Thinkorswim (ToS) desktop tables.

This is the Thinkorswim Watchlist / All account positions table (first trained model).
Typical columns: Symbol, Avg Cost, Pos Qty, P/L, P/L Open, Last.
A dash, blank, or "N/A" means the cell is unknown — use null. Never invent or estimate a number.
Pos Qty like "+150" is 150. "+406.81" is 406.81. A row with no quantity is watch-only (hasPosition=false).
Yellow numbered badges (e.g. 24) and person icons are not tickers or quantities.
Read symbols only from the Symbol column, not from headers, account names, or column titles.
P/L Open / P/L YTD are visible but you must not put them in the JSON.

Return JSON only:
{
  "layout": "tos_watchlist" | "tos_positions" | "ticker_list" | "unknown",
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
            text: "Extract every symbol row from this Thinkorswim table. Unknown values must be null.",
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
