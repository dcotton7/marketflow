/**
 * Index Constituents - Free GitHub Sources
 *
 * Fetches S&P 500, Russell 2000, Russell 3000 from GitHub CSVs.
 * Uses local cache files when available (refreshed monthly).
 *
 * UNIVERSE_SOURCE=github (default) | polygon (future upgrade)
 */

import * as fs from "fs";
import * as path from "path";

export type UniverseId = "sp500" | "russell2000" | "russell3000";

const DATA_DIR = path.join(process.cwd(), "data", "constituents");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h in-memory cache

const GITHUB_URLS: Record<UniverseId, string> = {
  sp500:
    "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
  russell2000:
    "https://raw.githubusercontent.com/ikoniaris/Russell2000/master/russell_2000_components.csv",
  russell3000:
    "https://raw.githubusercontent.com/dkelly-proj/tickers-russell-3k/main/Russell_3000_Tickers_20200629.csv",
};

const LOCAL_FILES: Record<UniverseId, string> = {
  sp500: path.join(DATA_DIR, "sp500.csv"),
  russell2000: path.join(DATA_DIR, "russell2000.csv"),
  russell3000: path.join(DATA_DIR, "russell3000.csv"),
};

// In-memory cache
const cache: { tickers: string[]; ts: number } = {} as any;

function parseCSV(text: string, universe: UniverseId): string[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const cols = header.split(",").map((c) => c.trim());
  // S&P 500: Symbol; Russell 2000: Ticker; Russell 3000: Ticker_Symbol
  const symbolIdx =
    cols.findIndex((c) => c === "symbol") >= 0 ? cols.findIndex((c) => c === "symbol") :
    cols.findIndex((c) => c.includes("ticker")) >= 0 ? cols.findIndex((c) => c.includes("ticker")) :
    0;

  const tickers: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const parts = row.split(",").map((p) => p.trim());
    const sym = (parts[symbolIdx] || parts[0] || "").toUpperCase();
    if (sym && sym !== "SYMBOL" && sym !== "TICKER" && /^[A-Z0-9.]+$/.test(sym)) {
      tickers.push(sym);
    }
  }
  return [...new Set(tickers)].sort();
}

async function fetchFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function readLocalFile(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Get constituent tickers for an index.
 * Reads from local cache files first, then falls back to GitHub.
 */
export async function getConstituents(universe: UniverseId): Promise<string[]> {
  const cacheKey = universe;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].ts < CACHE_TTL_MS) {
    return cache[cacheKey].tickers;
  }

  const localPath = LOCAL_FILES[universe];
  const local = readLocalFile(localPath);
  if (local) {
    const tickers = parseCSV(local, universe);
    cache[cacheKey] = { tickers, ts: Date.now() };
    return tickers;
  }

  const url = GITHUB_URLS[universe];
  const text = await fetchFromUrl(url);
  const tickers = parseCSV(text, universe);
  cache[cacheKey] = { tickers, ts: Date.now() };
  return tickers;
}

/**
 * Synchronous get - uses cache only. Call getConstituents() at startup to warm cache.
 */
export function getConstituentsSync(universe: UniverseId): string[] {
  if (cache[universe]) return cache[universe].tickers;
  const local = readLocalFile(LOCAL_FILES[universe]);
  if (local) {
    const tickers = parseCSV(local, universe);
    cache[universe] = { tickers, ts: Date.now() };
    return tickers;
  }
  return [];
}

export { DATA_DIR, LOCAL_FILES, GITHUB_URLS };
