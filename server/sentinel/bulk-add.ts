import { z } from "zod";
import { TICKER_RE } from "@shared/ticker-paste";

export const BULK_ADD_MAX = 300;

export const bulkAddSchema = z.object({
  watchlistId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        shares: z.number().finite().positive().nullable().optional(),
        entry: z.number().finite().positive().nullable().optional(),
      }),
    )
    .min(1)
    .max(BULK_ADD_MAX),
});

export interface BulkAddPlan {
  add: { symbol: string; shares: number | null; entry: number | null }[];
  existing: string[];
  invalid: string[];
}

/** What a bulk add does to a list that already holds `have`: valid, new symbols once each, in paste order. */
export function planBulkAdd(items: z.infer<typeof bulkAddSchema>["items"], have: Iterable<string>): BulkAddPlan {
  const inList = new Set([...have].map((s) => s.trim().toUpperCase()));
  const plan: BulkAddPlan = { add: [], existing: [], invalid: [] };
  const seen = new Set<string>();
  for (const it of items) {
    const symbol = it.symbol.trim().toUpperCase();
    if (!TICKER_RE.test(symbol)) plan.invalid.push(it.symbol);
    else if (inList.has(symbol)) plan.existing.push(symbol);
    else if (!seen.has(symbol)) {
      seen.add(symbol);
      plan.add.push({ symbol, shares: it.shares ?? null, entry: it.entry ?? null });
    }
  }
  return plan;
}
