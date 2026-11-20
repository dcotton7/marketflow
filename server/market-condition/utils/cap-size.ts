/**
 * Cap size per ticker, from the same stored bucket the size filter uses (tickers.market_cap_size: MEGA, LARGE,
 * MID, SMALL, MICRO). A ticker without a stored bucket gets null, never a guess.
 */
import { sql } from "drizzle-orm";

export type CapSize = "MEGA" | "LARGE" | "MID" | "SMALL" | "MICRO";
const BUCKETS = new Set<CapSize>(["MEGA", "LARGE", "MID", "SMALL", "MICRO"]);

export function normalizeCapSize(v: unknown): CapSize | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return BUCKETS.has(s as CapSize) ? (s as CapSize) : null;
}

/** Add `capSize` to each row (by its `symbol`); nothing else on the row changes. */
export function withCapSize<T extends { symbol: string }>(rows: T[], sizes: Map<string, CapSize>): (T & { capSize: CapSize | null })[] {
  return rows.map((r) => ({ ...r, capSize: sizes.get(String(r.symbol).toUpperCase()) ?? null }));
}

type Exec = { execute: (q: any) => Promise<any> };
const TTL_MS = 10 * 60_000;
let cache: { at: number; map: Map<string, CapSize> } | null = null;

/** Every ticker's stored bucket (one small query, kept 10 minutes). Empty map when the read fails. */
export async function loadCapSizes(db: Exec | null, now = Date.now()): Promise<Map<string, CapSize>> {
  if (cache && now - cache.at < TTL_MS) return cache.map;
  const map = new Map<string, CapSize>();
  if (!db) return map;
  try {
    const r: any = await db.execute(sql`SELECT symbol, market_cap_size FROM tickers WHERE market_cap_size IS NOT NULL`);
    for (const x of r?.rows ?? r ?? []) {
      const c = normalizeCapSize(x.market_cap_size);
      if (c) map.set(String(x.symbol).toUpperCase(), c);
    }
    cache = { at: now, map };
  } catch (err) {
    console.warn("[CapSize] read failed; capSize is null this time:", err);
  }
  return map;
}
export function resetCapSizeCacheForTests() { cache = null; }
