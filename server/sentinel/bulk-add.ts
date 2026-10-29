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
  /** Tickers already in the list take the given entry, and in a portfolio list the given shares too. */
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
  opts: { update?: boolean; remove?: string[]; entryOnly?: boolean } = {},
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
      const shares = opts.entryOnly ? null : it.shares ?? null;
      if (opts.update && (shares != null || it.entry != null)) {
        plan.update.push({ symbol, shares, entry: it.entry ?? null });
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

/** Named tickers out of one list (any list); never the list itself. */
export const removeTickersSchema = z.object({
  watchlistId: z.number().int().positive(),
  symbols: z.array(z.string().min(1).max(12)).min(1).max(BULK_ADD_MAX),
});

export interface RemoveTickersPlan {
  remove: string[];
  notFound: string[];
  invalid: string[];
}

export function planRemoveTickers(symbols: string[], have: Iterable<string>): RemoveTickersPlan {
  const inList = new Set([...have].map((s) => s.trim().toUpperCase()));
  const plan: RemoveTickersPlan = { remove: [], notFound: [], invalid: [] };
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!TICKER_RE.test(symbol)) plan.invalid.push(raw);
    else if (plan.remove.includes(symbol) || plan.notFound.includes(symbol)) continue;
    else (inList.has(symbol) ? plan.remove : plan.notFound).push(symbol);
  }
  return plan;
}

/** A new list's name is taken when another of his lists has it, ignoring case and outer spaces. */
export function watchlistNameTaken(name: string, lists: { name: string }[]): boolean {
  const want = name.trim().toLowerCase();
  return lists.some((l) => l.name.trim().toLowerCase() === want);
}
