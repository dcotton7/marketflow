/**
 * Daily regime history for reads (Trading Buddy: "how many days since the market turned risk-off").
 * From regime_history (engine/market-history.ts, a reading every 15 minutes in market hours): one row per market
 * date, the day's last reading. raiLabel is the stored RAI label; regime is MarketFlow's own mapping of it
 * (exports.ts getMarketRegimeForScanner): AGGRESSIVE -> RISK_ON, DEFENSIVE -> RISK_OFF, else NEUTRAL.
 */
import { sql } from "drizzle-orm";

export const DEFAULT_DAYS = 60;
export const MAX_DAYS = 400;

export function parseDays(q: unknown): number {
  const n = Math.floor(Number(q));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

export function regimeOf(label: string): "RISK_ON" | "RISK_OFF" | "NEUTRAL" {
  return label === "AGGRESSIVE" ? "RISK_ON" : label === "DEFENSIVE" ? "RISK_OFF" : "NEUTRAL";
}

export interface RegimeDay { date: string; raiLabel: string; regime: "RISK_ON" | "RISK_OFF" | "NEUTRAL"; raiScore: number; lastReadingAt: string }

/** Raw readings (any order) to one row per date, the last reading of each day, newest date first, at most `days`. */
export function toDaily(rows: { market_date: string; slot_at: string | Date; label: string; score: number | string }[], days: number): RegimeDay[] {
  const last = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const d = String(r.market_date), cur = last.get(d);
    if (!cur || new Date(r.slot_at).getTime() > new Date(cur.slot_at).getTime()) last.set(d, r);
  }
  return [...last.values()]
    .sort((a, b) => String(b.market_date).localeCompare(String(a.market_date)))
    .slice(0, days)
    .map((r) => ({ date: String(r.market_date), raiLabel: String(r.label), regime: regimeOf(String(r.label)), raiScore: Number(r.score), lastReadingAt: new Date(r.slot_at).toISOString() }));
}

type Exec = { execute: (q: any) => Promise<any> };
export async function readRegimeHistory(db: Exec, days: number): Promise<{ days: number; rows: RegimeDay[]; note?: string }> {
  try {
    const r: any = await db.execute(
      sql`SELECT DISTINCT ON (market_date) market_date, slot_at, label, score FROM regime_history WHERE market_date IN (SELECT DISTINCT market_date FROM regime_history ORDER BY market_date DESC LIMIT ${days}) ORDER BY market_date DESC, slot_at DESC`,
    );
    return { days, rows: toDaily(r?.rows ?? r ?? [], days) };
  } catch {
    // the table is created by the first regime write (market-history.ts); before that there is no history yet
    return { days, rows: [], note: "no regime history stored yet" };
  }
}
