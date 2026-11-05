import { z } from "zod";

/** A watchlist row as the table and the add routes send it. direction is the row's side (long or short). */
export const watchlistSchema = z.object({
  symbol: z.string().min(1).max(10),
  watchlistId: z.number().int().positive().optional(),
  targetEntry: z.number().positive().nullable().optional(),
  stopPlan: z.number().positive().nullable().optional(),
  targetPlan: z.number().positive().nullable().optional(),
  alertPrice: z.number().positive().nullable().optional(),
  shares: z.number().positive().nullable().optional(),
  direction: z.enum(["long", "short"]).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD").nullable().optional(),
  thesis: z.string().nullable().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
});
