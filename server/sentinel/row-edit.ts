/**
 * A watchlist row edit from the table (PATCH /api/sentinel/watchlist/:id) as it is stored. Two things a trader does
 * for a short that the row schema didn't take before:
 * - the Side cell sends { direction: "short" | "long" } (zod dropped the unknown key, so the toggle saved nothing);
 * - typing a negative share count ("-100", as thinkorswim shows a short) means 100 shares short: the row keeps the
 *   count positive and its direction says short. A side sent with it wins.
 */
export function normalizeRowEdit(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = { ...(body as Record<string, unknown>) };
  if (typeof b.direction === "string") b.direction = b.direction.trim().toLowerCase();
  if (typeof b.shares === "number" && Number.isFinite(b.shares) && b.shares < 0) {
    b.shares = Math.abs(b.shares);
    if (b.direction === undefined) b.direction = "short";
  }
  return b;
}
