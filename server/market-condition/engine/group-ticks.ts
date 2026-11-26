/**
 * Append-only 5-minute history for sectors and cap-size buckets, next to theme_ticks_5m (market-history.ts), so the
 * gateway's velocity read can answer "how fast is a sector moving" (docs/gateway-reads.md, item 3).
 *
 * Each 5-minute slot in market hours, from the same live snapshot the theme tick is computed from (every ticker the
 * theme engine polls, previous-close baseline, all sizes): per sector (tickers.sector) and per cap-size bucket
 * (tickers.market_cap_size, the bucket the size filter uses), the median day % change, the share of names green, the
 * number of names, and the rank by median within its kind; plus one 'benchmark' row with SPY's day % change.
 * Rows are only INSERTed, ON CONFLICT DO NOTHING on (slot_at, kind, group_id); nothing deletes, updates or prunes.
 * Growth: about 20 rows a slot, 78 slots a day: ~1,600 small rows (~150 KB) a day.
 * Same SQL as migrations/030_group_ticks_5m.sql (CREATE ... IF NOT EXISTS) before the first write.
 */
import { sql } from "drizzle-orm";
import { etClock, inMarketHours, slotStart, TICK_MS } from "./market-history";

export type GroupKind = "sector" | "size" | "benchmark";
export interface GroupTickRow {
  slotAt: Date;
  marketDate: string;
  kind: GroupKind;
  groupId: string;
  rank: number;
  medianPct: number;
  breadthPct: number | null;
  members: number;
}
export interface GroupTickStore { insertGroupTicks(rows: GroupTickRow[]): Promise<number> }

export const MIN_MEMBERS = 3;
const SIZE_ORDER = ["MEGA", "LARGE", "MID", "SMALL", "MICRO"];

const round2 = (n: number) => Math.round(n * 100) / 100;
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pure: the slot's rows (slot and date filled in by the caller). Names with no class, or no finite change, are left out. */
export function computeGroupTicks(
  live: { symbol: string; changePct: number }[],
  classOf: (symbol: string) => { sector: string | null; capSize: string | null } | undefined,
  spyPct: number | null,
): Omit<GroupTickRow, "slotAt" | "marketDate">[] {
  const buckets: Record<"sector" | "size", Map<string, number[]>> = { sector: new Map(), size: new Map() };
  const seen = new Set<string>();
  for (const t of live) {
    const sym = t.symbol.toUpperCase();
    if (seen.has(sym) || sym === "SPY" || !Number.isFinite(t.changePct)) continue;
    seen.add(sym);
    const c = classOf(sym);
    if (!c) continue;
    const sector = c.sector?.trim();
    if (sector && sector.toLowerCase() !== "unknown") (buckets.sector.get(sector) ?? buckets.sector.set(sector, []).get(sector)!).push(t.changePct);
    const size = c.capSize?.trim().toUpperCase();
    if (size && SIZE_ORDER.includes(size)) (buckets.size.get(size) ?? buckets.size.set(size, []).get(size)!).push(t.changePct);
  }
  const out: Omit<GroupTickRow, "slotAt" | "marketDate">[] = [];
  for (const kind of ["sector", "size"] as const) {
    const rows = [...buckets[kind]].filter(([, xs]) => xs.length >= MIN_MEMBERS).map(([groupId, xs]) => ({
      kind, groupId, medianPct: round2(median(xs)), breadthPct: round2((xs.filter((x) => x > 0).length / xs.length) * 100), members: xs.length, rank: 0,
    }));
    rows.sort((a, b) => b.medianPct - a.medianPct || a.groupId.localeCompare(b.groupId));
    rows.forEach((r, i) => (r.rank = i + 1));
    out.push(...rows);
  }
  if (spyPct !== null && Number.isFinite(spyPct)) out.push({ kind: "benchmark", groupId: "SPY", medianPct: round2(spyPct), breadthPct: null, members: 1, rank: 1 });
  return out;
}

let doneSlot = 0;
export function resetGroupTicksForTests() { doneSlot = 0; }

/** Write this slot's rows once (market hours only, same slot rule as the theme tick). Never throws. */
export async function recordGroupTicks(
  store: GroupTickStore,
  inputs: () => Promise<{ live: { symbol: string; changePct: number }[]; classOf: (s: string) => { sector: string | null; capSize: string | null } | undefined; spyPct: number | null }>,
  now: Date = new Date(),
): Promise<number> {
  if (!inMarketHours(now)) return 0;
  const slot = slotStart(now, TICK_MS);
  if (doneSlot === slot.getTime()) return 0;
  try {
    const { live, classOf, spyPct } = await inputs();
    const rows = computeGroupTicks(live, classOf, spyPct).map((r) => ({ ...r, slotAt: slot, marketDate: etClock(now).date }));
    const n = rows.length ? await store.insertGroupTicks(rows) : 0;
    doneSlot = slot.getTime();
    return n;
  } catch (err) {
    console.warn("[MarketHistory] group tick write failed:", err);
    return 0;
  }
}

// ---- Postgres --------------------------------------------------------------------------------------------------
export const GROUP_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS group_ticks_5m (id SERIAL PRIMARY KEY, slot_at TIMESTAMPTZ NOT NULL, market_date TEXT NOT NULL, kind TEXT NOT NULL, group_id TEXT NOT NULL, rank INTEGER NOT NULL, median_pct DOUBLE PRECISION NOT NULL, breadth_pct DOUBLE PRECISION, members INTEGER NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (slot_at, kind, group_id))`,
  `CREATE INDEX IF NOT EXISTS idx_group_ticks_5m_kind ON group_ticks_5m (kind, slot_at)`,
];
type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
let ensured = false;

export function pgGroupTickStore(db: Exec): GroupTickStore {
  return {
    async insertGroupTicks(rows) {
      if (!rows.length) return 0;
      if (!ensured) {
        for (const s of GROUP_DDL) await db.execute(sql.raw(s));
        ensured = true;
      }
      const values = rows.map((r) => sql`(${r.slotAt.toISOString()}::timestamptz, ${r.marketDate}, ${r.kind}, ${r.groupId}, ${r.rank}, ${r.medianPct}, ${r.breadthPct}, ${r.members})`);
      const res = await db.execute(sql`INSERT INTO group_ticks_5m (slot_at, market_date, kind, group_id, rank, median_pct, breadth_pct, members) VALUES ${sql.join(values, sql`, `)} ON CONFLICT (slot_at, kind, group_id) DO NOTHING`);
      return Number(res?.rowCount ?? 0);
    },
  };
}

/** Each ticker's sector and stored size bucket (tickers table), kept 6 hours. Empty map when the read fails. */
let classCache: { at: number; map: Map<string, { sector: string | null; capSize: string | null }> } | null = null;
export async function loadGroupClasses(db: Exec, now = Date.now()) {
  if (classCache && now - classCache.at < 6 * 3600_000) return classCache.map;
  const map = new Map<string, { sector: string | null; capSize: string | null }>();
  try {
    for (const r of rowsOf(await db.execute(sql`SELECT symbol, sector, market_cap_size FROM tickers`))) {
      map.set(String(r.symbol).toUpperCase(), { sector: r.sector ?? null, capSize: r.market_cap_size ?? null });
    }
    classCache = { at: now, map };
  } catch {
    /* keep the old map, or an empty one */
  }
  return classCache?.map ?? map;
}
