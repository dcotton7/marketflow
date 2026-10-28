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
  /** Portfolio lists only: tickers already in the list take the given shares and entry. */
  update: z.boolean().optional(),
  /** Portfolio lists only: tickers to take out of the list (never one that is also in items). */
  remove: z.array(z.string().min(1).max(12)).max(BULK_ADD_MAX).optional(),
});

type Position = { symbol: string; shares: number | null; entry: number | null };

export interface BulkAddPlan {
  add: Position[];
  existing: string[];
  invalid: string[];
  /** Existing tickers whose shares or entry change (only with update). */
  update: Position[];
  /** Tickers in the list to remove (only those asked for, in the list, and not in items). */
  remove: string[];
}

/** What a bulk add does to a list that already holds `have`: valid, new symbols once each, in paste order. */
export function planBulkAdd(
  items: z.infer<typeof bulkAddSchema>["items"],
  have: Iterable<string>,
  opts: { update?: boolean; remove?: string[] } = {},
): BulkAddPlan {
  const inList = new Set([...have].map((s) => s.trim().toUpperCase()));
  const plan: BulkAddPlan = { add: [], existing: [], invalid: [], update: [], remove: [] };
  const seen = new Set<string>();
  for (const it of items) {
    const symbol = it.symbol.trim().toUpperCase();
    if (!TICKER_RE.test(symbol)) plan.invalid.push(it.symbol);
    else if (seen.has(symbol)) continue;
    else if (inList.has(symbol)) {
      seen.add(symbol);
      plan.existing.push(symbol);
      if (opts.update && (it.shares != null || it.entry != null)) {
        plan.update.push({ symbol, shares: it.shares ?? null, entry: it.entry ?? null });
      }
    } else {
      seen.add(symbol);
      plan.add.push({ symbol, shares: it.shares ?? null, entry: it.entry ?? null });
    }
  }
  for (const raw of opts.remove ?? []) {
    const symbol = raw.trim().toUpperCase();
    if (inList.has(symbol) && !seen.has(symbol) && !plan.remove.includes(symbol)) plan.remove.push(symbol);
  }
  return plan;
}
