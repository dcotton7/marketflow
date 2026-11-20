const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 400;

/** The date range a read asks for (date=, or from= and to=), or an error message. */
export function parseRange(q: Record<string, unknown>): { from: string; to: string } | { error: string } {
  const date = q.date ? String(q.date) : null;
  const from = date ?? (q.from ? String(q.from) : null);
  const to = date ?? (q.to ? String(q.to) : from);
  if (!from || !to || !DAY.test(from) || !DAY.test(to)) return { error: "date=YYYY-MM-DD or from=YYYY-MM-DD&to=YYYY-MM-DD required" };
  if (from > to) return { error: "from is after to" };
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > MAX_RANGE_DAYS) return { error: `at most ${MAX_RANGE_DAYS} days per request` };
  return { from, to };
}
