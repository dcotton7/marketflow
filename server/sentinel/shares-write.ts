import { z } from "zod";

export const sharesWriteSchema = z.object({
  shares: z.number().finite().min(0),
  expectShares: z.number().finite().positive(),
});

export type SharesWriteResult =
  | { status: 200; shares: number }
  | { status: 400 | 403 | 404 | 409; error: string; shares?: number | null };

/** A trim only: the count can go down from what the caller last saw, never up, and never over a changed row. */
export function checkSharesWrite(
  item: { userId: number; shares: number | null } | null | undefined,
  userId: number | undefined,
  body: unknown,
): SharesWriteResult {
  if (!item) return { status: 404, error: "Watchlist item not found" };
  if (!userId || item.userId !== userId) return { status: 403, error: "Forbidden" };
  const parsed = sharesWriteSchema.safeParse(body);
  if (!parsed.success) return { status: 400, error: parsed.error.errors[0].message };
  const { shares, expectShares } = parsed.data;
  if (item.shares !== expectShares) return { status: 409, error: "Shares changed since the alert", shares: item.shares };
  if (shares >= expectShares) return { status: 400, error: "A trim must lower the share count" };
  return { status: 200, shares };
}
