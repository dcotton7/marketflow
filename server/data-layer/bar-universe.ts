/**
 * The set of tickers whose daily bars MarketFlow keeps: the static theme lists, plus every row of the tickers table
 * (the lists alone were 657 names; the tickers table adds the rest), minus the retired file (data/delisted-symbols.json).
 *
 * Why this exists: the daily bar job used to refresh only getAllUniverseTickers() (the static lists), so every
 * ticker that lives only in the tickers table stopped getting bars. The setup scans and the market card breadth
 * read the same table, so those names dropped out of them. One definition, used by the daily job and the backfill.
 *
 * Pure helpers (merge, expected session, stale split) are separate from the database read so they can be tested.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getEtClock } from "@shared/usEquityMarketSession";
import { isMarketHoliday } from "@shared/us-market-holidays";
import { loadActivePoolSymbols } from "./scan-pool";

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

/** Static lists + tickers table, minus retired; upper-cased, de-duplicated, sorted. */
export function mergeBarUniverse(staticTickers: Iterable<string>, tickerRows: Iterable<string>, retired: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const s of staticTickers) if (s && s.trim()) out.add(normalizeSymbol(s));
  for (const s of tickerRows) if (s && s.trim()) out.add(normalizeSymbol(s));
  for (const s of retired) out.delete(normalizeSymbol(s));
  return Array.from(out).sort();
}

export function readRetiredSymbols(file = path.resolve(process.cwd(), "data/delisted-symbols.json")): string[] {
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => normalizeSymbol(String(x))) : [];
  } catch {
    return [];
  }
}

function rowsOf(result: any): any[] {
  return result?.rows ?? (Array.isArray(result) ? result : []);
}

/** SCAN_POOL=off is the kill switch: bars (and the pool refresh) go back to the theme universe alone. */
export function scanPoolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SCAN_POOL ?? "").trim().toLowerCase() !== "off";
}

/** The theme universe: static lists + tickers table - retired. No pool names. */
export async function loadThemeUniverse(db: any, staticTickers: string[]): Promise<string[]> {
  const rows = rowsOf(await db.execute(sql`SELECT symbol FROM tickers`));
  return mergeBarUniverse(staticTickers, rows.map((r) => String(r.symbol ?? "")), readRetiredSymbols());
}

/** Bars universe: the theme universe plus the active scan pool (scan-pool.ts), minus retired. */
export async function loadBarUniverse(db: any, staticTickers: string[], opts: { includePool?: boolean } = {}): Promise<string[]> {
  const theme = await loadThemeUniverse(db, staticTickers);
  if (opts.includePool === false || !scanPoolEnabled()) return theme;
  const pool = await loadActivePoolSymbols(db);
  return mergeBarUniverse(theme, pool, readRetiredSymbols());
}

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isSessionDay(dateKey: string): boolean {
  const dow = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !isMarketHoliday(dateKey);
}

/** The newest trading day whose daily bar is final: today after 16:30 ET on a session day, else the session before. */
export function expectedLastSession(now: Date = new Date()): string {
  const { dateKey, minuteOfDay } = getEtClock(now);
  let d = dateKey;
  if (!isSessionDay(d) || minuteOfDay < 16 * 60 + 30) d = addDays(d, -1);
  while (!isSessionDay(d)) d = addDays(d, -1);
  return d;
}

/**
 * Split the universe by the newest stored bar. Stale = no bar, or newest bar older than the expected last session.
 * Stale names come back oldest-first (no bar at all first) so a run that is cut short still makes progress and the
 * next run starts where the neglected names are, not at "A" again.
 */
export function splitStale(universe: string[], newestBySymbol: Map<string, string>, expected: string): { stale: string[]; fresh: string[] } {
  const stale: string[] = [];
  const fresh: string[] = [];
  for (const sym of universe) {
    const newest = newestBySymbol.get(sym);
    if (!newest || newest < expected) stale.push(sym);
    else fresh.push(sym);
  }
  stale.sort((a, b) => {
    const na = newestBySymbol.get(a) ?? "";
    const nb = newestBySymbol.get(b) ?? "";
    return na === nb ? (a < b ? -1 : 1) : na < nb ? -1 : 1;
  });
  return { stale, fresh };
}

/** Newest stored bar date per symbol (one aggregate row per symbol, not the bars themselves). */
export async function loadNewestBars(db: any): Promise<Map<string, string>> {
  const rows = rowsOf(await db.execute(sql`SELECT symbol, MAX(bar_date)::text AS newest FROM historical_bars GROUP BY symbol`));
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.symbol && r.newest) m.set(normalizeSymbol(String(r.symbol)), String(r.newest).slice(0, 10));
  }
  return m;
}
