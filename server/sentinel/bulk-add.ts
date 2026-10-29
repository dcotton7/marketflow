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
        /** From Screen: a negative Pos Qty. Stored as direction "short", without shares or entry. */
        short: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(BULK_ADD_MAX),
  /** Tickers already in the list take the given entry, and in a portfolio list the given shares too. */
  update: z.boolean().optional(),
  /** Portfolio lists only: tickers to take out of the list (never one that is also in items). */
  remove: z.array(z.string().min(1).max(12)).max(BULK_ADD_MAX).optional(),
});

type Position = { symbol: string; shares: number | null; entry: number | null; short?: boolean };

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
      if (opts.update && it.short === true && !opts.entryOnly) {
        // Now short in a portfolio list: the row's old long shares and entry no longer apply.
        plan.update.push({ symbol, shares: null, entry: null, short: true });
      } else if (opts.update && (shares != null || it.entry != null)) {
        plan.update.push({ symbol, shares, entry: it.entry ?? null, ...(it.short === false ? { short: false } : {}) });
      }
    } else {
      seen.add(symbol);
      const short = it.short === true;
      plan.add.push({ symbol, shares: short ? null : it.shares ?? null, entry: short ? null : it.entry ?? null,
        ...(it.short != null ? { short } : {}) });
    }
  }
  for (const raw of opts.remove ?? []) {
    const symbol = raw.trim().toUpperCase();
    if (inList.has(symbol) && !seen.has(symbol) && !plan.remove.includes(symbol)) plan.remove.push(symbol);
  }
  return plan;
}

/** The row writes of a bulk add, done inside one database transaction by the caller. */
export interface BulkAddWrites {
  insert(row: { symbol: string; shares: number | null; targetEntry: number | null; direction?: "long" | "short" }): Promise<unknown>;
  update(id: number, patch: Record<string, unknown>): Promise<unknown>;
  remove(id: number): Promise<unknown>;
}

/**
 * Applies a plan to the list's rows (`have`: its watching rows): adds first, then the updates, then the removals, so a
 * failure part way never leaves a list with tickers taken out and nothing put in. Any write that throws throws out
 * of here, and the caller's transaction rolls the rest back.
 */
export async function applyBulkAdd(
  plan: BulkAddPlan,
  have: { id: number; symbol: string }[],
  w: BulkAddWrites,
): Promise<{ added: string[]; updated: string[]; removed: string[] }> {
  const bySymbol = (s: string) => have.filter((i) => i.symbol.trim().toUpperCase() === s);
  const added: string[] = [];
  for (const it of plan.add) {
    await w.insert({ symbol: it.symbol, shares: it.shares, targetEntry: it.entry,
      ...(it.short != null ? { direction: it.short ? "short" : "long" } : {}) });
    added.push(it.symbol);
  }
  const updated: string[] = [];
  for (const it of plan.update) {
    const patch = it.short === true
      ? { direction: "short", shares: null, targetEntry: null }
      : {
          ...(it.shares != null ? { shares: it.shares } : {}),
          ...(it.entry != null ? { targetEntry: it.entry } : {}),
          ...(it.short === false ? { direction: "long" } : {}),
        };
    for (const row of bySymbol(it.symbol)) await w.update(row.id, patch);
    updated.push(it.symbol);
  }
  const removed: string[] = [];
  for (const s of plan.remove) {
    for (const row of bySymbol(s)) await w.remove(row.id);
    removed.push(s);
  }
  return { added, updated, removed };
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
