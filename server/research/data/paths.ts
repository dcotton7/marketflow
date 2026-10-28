import * as path from "path";

/** Local-only folders on Don's PC (gitignored). */
export const RESEARCH_CACHE_DIR = process.env.RESEARCH_CACHE_DIR || path.join(process.cwd(), ".research-cache");
export const RESEARCH_RESULTS_DIR = process.env.RESEARCH_RESULTS_DIR || path.join(process.cwd(), "research-results");

export function cachePath(...parts: string[]): string {
  return path.join(RESEARCH_CACHE_DIR, ...parts);
}

export function safeSymbolFile(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9._-]/g, "_");
}
