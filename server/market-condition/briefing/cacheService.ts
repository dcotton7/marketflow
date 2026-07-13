import { getMarketDateTime } from "../utils/theme-tracker-time";
import { getMarketSession } from "../universe";
import type { BriefingMode, ThemeBriefingResponse } from "./types";

const CACHE_TTL_MS = 60 * 60 * 1000;
const POST_CLOSE_SETTLE_MINUTES = 15;
const MARKET_CLOSE_MINUTES = 16 * 60;

interface CacheEntry {
  response: ThemeBriefingResponse;
  cachedAt: number;
}

const briefingCache = new Map<string, CacheEntry>();
const MAX_BRIEFING_CACHE = 10;

export function getBriefingCacheKey(mode: BriefingMode, referenceSession: string): string {
  return `${mode}:${referenceSession}`;
}

function minutesSinceCloseEt(anchor: Date): number {
  const { hour, minute } = getMarketDateTime(anchor);
  return hour * 60 + minute - MARKET_CLOSE_MINUTES;
}

/**
 * Post-market cache policy:
 * - No cache read in first 15 min after 4:00 PM ET (tape settling).
 * - No cache read if the 1-hour lookback window starts before 4:15 PM ET.
 * - Otherwise allow read when entry age < 1 hour.
 */
export function briefingCachePolicy(
  mode: BriefingMode,
  anchor = new Date()
): { allowRead: boolean; allowWrite: boolean } {
  if (mode !== "post") {
    return { allowRead: false, allowWrite: false };
  }

  const session = getMarketSession();
  if (session !== "AFTER_HOURS") {
    return { allowRead: false, allowWrite: false };
  }

  const minsSinceClose = minutesSinceCloseEt(anchor);

  if (minsSinceClose < POST_CLOSE_SETTLE_MINUTES) {
    return { allowRead: false, allowWrite: true };
  }

  const lookbackStartMins = minsSinceClose - CACHE_TTL_MS / 60_000;
  if (lookbackStartMins < POST_CLOSE_SETTLE_MINUTES) {
    return { allowRead: false, allowWrite: true };
  }

  return { allowRead: true, allowWrite: true };
}

export function getCachedBriefing(key: string): CacheEntry | null {
  const entry = briefingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= CACHE_TTL_MS) {
    briefingCache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedBriefing(key: string, response: ThemeBriefingResponse): void {
  if (briefingCache.size >= MAX_BRIEFING_CACHE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of briefingCache) {
      if (v.cachedAt < oldestTime) { oldestTime = v.cachedAt; oldestKey = k; }
    }
    if (oldestKey) briefingCache.delete(oldestKey);
  }
  briefingCache.set(key, { response, cachedAt: Date.now() });
}

export function clearBriefingCache(key?: string): void {
  if (key) briefingCache.delete(key);
  else briefingCache.clear();
}
