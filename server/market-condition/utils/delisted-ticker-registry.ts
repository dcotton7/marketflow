/**
 * Delisted ticker registry — remove symbols from universe when market data confirms
 * they no longer trade, and persist so they stay excluded after restart.
 */

import fs from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { tickerSliceMemberships, tickers as tickerTable } from "@shared/schema";
import {
  CLUSTERS,
  getTickerPrimaryCluster,
  type ClusterId,
} from "../universe";
import { refreshThemeMembersCache, isCacheInitialized, getThemesForSymbol } from "./theme-db-loader";

const DELISTED_FILE = path.resolve(process.cwd(), "data/delisted-symbols.json");

const delistedSet = new Set<string>();
let registryLoaded = false;
const checkCooldownMs = 60 * 60 * 1000;
const lastCheckedAt = new Map<string, number>();
const purgeInFlight = new Set<string>();

function normalize(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function isDelistedSymbol(symbol: string): boolean {
  return delistedSet.has(normalize(symbol));
}

export function getDelistedSymbols(): string[] {
  return Array.from(delistedSet).sort();
}

async function persistDelistedSymbols(): Promise<void> {
  const sorted = getDelistedSymbols();
  await fs.writeFile(DELISTED_FILE, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

async function loadDelistedFile(): Promise<string[]> {
  try {
    // Strip UTF-8 BOM if present (PowerShell Set-Content often writes one).
    const raw = (await fs.readFile(DELISTED_FILE, "utf8")).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => normalize(String(s))).filter(Boolean);
    }
  } catch {
    /* first run — file may not exist */
  }
  return [];
}

function removeFromClusters(symbol: string): ClusterId[] {
  const sym = normalize(symbol);
  const touched: ClusterId[] = [];
  for (const cluster of CLUSTERS) {
    const coreIdx = cluster.core.indexOf(sym);
    if (coreIdx >= 0) {
      cluster.core.splice(coreIdx, 1);
      touched.push(cluster.id);
    }
    const candIdx = cluster.candidates.indexOf(sym);
    if (candIdx >= 0) {
      cluster.candidates.splice(candIdx, 1);
      if (!touched.includes(cluster.id)) touched.push(cluster.id);
    }
  }
  return touched;
}

export function applyDelistedSymbolsToClusters(symbols: string[]): ClusterId[] {
  const touched = new Set<ClusterId>();
  for (const symbol of symbols) {
    for (const id of removeFromClusters(symbol)) {
      touched.add(id);
    }
  }
  return Array.from(touched);
}

/**
 * Load persisted delisted symbols and strip them from in-memory CLUSTERS + DB
 * theme membership so Theme Members cannot keep ranking dead tickers (e.g. IIVI/INFN).
 * Call before theme cache init on server startup.
 */
export async function initializeDelistedTickerRegistry(): Promise<void> {
  if (registryLoaded) return;
  const fromFile = await loadDelistedFile();
  for (const sym of fromFile) delistedSet.add(sym);
  const touched = applyDelistedSymbolsToClusters(fromFile);

  // Purge stale DB rows before theme cache init — otherwise ghosts (IIVI/INFN/USM)
  // stay as core/candidate with live quotes aliased to the new ticker but no bars → blank MAs.
  if (db && fromFile.length > 0) {
    let purged = 0;
    for (const sym of fromFile) {
      try {
        await db.delete(tickerSliceMemberships).where(eq(tickerSliceMemberships.symbol, sym));
        await db.delete(tickerTable).where(eq(tickerTable.symbol, sym));
        purged++;
      } catch (err) {
        console.warn(`[DelistedRegistry] DB purge failed for ${sym}:`, err);
      }
    }
    if (purged > 0) {
      console.log(`[DelistedRegistry] DB membership purge attempted for ${purged} delisted symbol(s)`);
    }
  }

  registryLoaded = true;
  console.log(
    `[DelistedRegistry] Loaded ${delistedSet.size} delisted symbol(s)${
      touched.length ? `; pruned from clusters: ${touched.join(", ")}` : ""
    }`
  );
}

export function isSymbolTrackedInUniverse(symbol: string): boolean {
  const sym = normalize(symbol);
  if (isDelistedSymbol(sym)) return false;
  if (getTickerPrimaryCluster(sym)) return true;
  if (isCacheInitialized() && getThemesForSymbol(sym).length > 0) return true;
  return false;
}

/** No bars in the last ~30 calendar days but older history exists → delisted. */
export async function isTickerDelistedOnMarket(symbol: string): Promise<boolean> {
  const sym = normalize(symbol);
  const { fetchAlpacaDailyBars } = await import("../../alpaca");

  const end = new Date();
  const recentStart = new Date();
  recentStart.setDate(recentStart.getDate() - 30);

  const recentBars = await fetchAlpacaDailyBars(sym, recentStart, end);
  if (recentBars.length > 0) return false;

  const longStart = new Date();
  longStart.setFullYear(longStart.getFullYear() - 3);
  const historical = await fetchAlpacaDailyBars(sym, longStart, end);
  if (historical.length === 0) return false;

  const lastBarMs = new Date(historical[historical.length - 1]!.date).getTime();
  const daysSinceLast = (end.getTime() - lastBarMs) / 86_400_000;
  return daysSinceLast > 21;
}

export async function removeTickerFromUniverse(
  symbol: string,
  reason = "delisted"
): Promise<{ removed: boolean; themes: ClusterId[] }> {
  const sym = normalize(symbol);
  if (!sym || isDelistedSymbol(sym)) {
    return { removed: false, themes: [] };
  }

  delistedSet.add(sym);
  await persistDelistedSymbols();

  const themes = removeFromClusters(sym);

  if (db) {
    await db.delete(tickerSliceMemberships).where(eq(tickerSliceMemberships.symbol, sym));
    await db.delete(tickerTable).where(eq(tickerTable.symbol, sym));
  }

  try {
    await refreshThemeMembersCache();
  } catch (err) {
    console.warn(`[DelistedRegistry] Cache refresh after removing ${sym}:`, err);
  }

  console.log(
    `[DelistedRegistry] Removed ${sym} from universe (${reason})${
      themes.length ? ` — themes: ${themes.join(", ")}` : ""
    }`
  );

  return { removed: true, themes };
}

/**
 * Fire-and-forget: when a universe ticker query returns no live data, verify delisted
 * and purge from DB + CLUSTERS + persisted registry.
 */
export function scheduleDelistedTickerCheck(symbol: string, reason: string): void {
  const sym = normalize(symbol);
  if (!sym || isDelistedSymbol(sym)) return;
  if (!isSymbolTrackedInUniverse(sym)) return;
  if (purgeInFlight.has(sym)) return;

  const last = lastCheckedAt.get(sym) ?? 0;
  if (Date.now() - last < checkCooldownMs) return;
  lastCheckedAt.set(sym, Date.now());
  purgeInFlight.add(sym);

  void (async () => {
    try {
      await initializeDelistedTickerRegistry();
      if (await isTickerDelistedOnMarket(sym)) {
        await removeTickerFromUniverse(sym, reason);
      }
    } catch (err) {
      console.warn(`[DelistedRegistry] Check failed for ${sym}:`, err);
    } finally {
      purgeInFlight.delete(sym);
    }
  })();
}
