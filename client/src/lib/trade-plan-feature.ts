import type { WatchlistColumnId } from "@/lib/watchlist-column-profile";

/**
 * Trade Plan overlays (entry/stop/target on charts), Ask Ivy overlay, and related UI.
 * Disabled until product revisits the feature.
 */
export const TRADE_PLAN_ENABLED = false;

export function isTradePlanEnabled(): boolean {
  return TRADE_PLAN_ENABLED;
}

export const TRADE_PLAN_WATCHLIST_COLUMN_IDS: readonly WatchlistColumnId[] = [
  "entry",
  "entryPct",
  "stop",
  "stopPct",
];

export function isTradePlanWatchlistColumn(id: WatchlistColumnId): boolean {
  return TRADE_PLAN_WATCHLIST_COLUMN_IDS.includes(id);
}
