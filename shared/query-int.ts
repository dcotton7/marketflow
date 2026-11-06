/**
 * A whole-number query param, clamped. Missing, empty or non-numeric gives the default, so a bad value never turns
 * into NaN (Drizzle drops a NaN .limit(), which read the whole table).
 */
export function queryInt(value: unknown, def: number, min: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = raw == null || raw === "" ? NaN : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
