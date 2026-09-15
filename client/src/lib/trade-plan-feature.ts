import type { WatchlistColumnId } from "@/lib/watchlist-column-profile";

/**
 * Trade Plan overlays (entry/stop/target on charts), Ask Ivy overlay, and related UI.
 * Charts load saved watchlist targetEntry / stopPlan / targetPlan through AskIvyOverlay.
 */
export const TRADE_PLAN_ENABLED = true;

export function isTradePlanEnabled(): boolean {
  return TRADE_PLAN_ENABLED;
}

export const TRADE_PLAN_WATCHLIST_COLUMN_IDS: readonly WatchlistColumnId[] = [
  "stop",
  "stopPct",
];

export function isTradePlanWatchlistColumn(id: WatchlistColumnId): boolean {
  return TRADE_PLAN_WATCHLIST_COLUMN_IDS.includes(id);
}

export type TradePlanPriceLine = {
  price: number;
  color: string;
  label: string;
};

/**
 * Chart lines are lite: entry first. Stop/target only if an entry exists.
 * Live overlay values win; otherwise the watchlist saved plan.
 */
export function buildWatchlistTradePlanLines(args: {
  liveEntry?: number | null;
  liveStop?: number | null;
  liveTarget?: number | null;
  saved?: { entry?: number | null; stop?: number | null; target?: number | null } | null;
}): TradePlanPriceLine[] {
  if (!isTradePlanEnabled()) return [];
  const entry = args.liveEntry ?? args.saved?.entry ?? null;
  if (entry == null || !(entry > 0)) return [];
  const lines: TradePlanPriceLine[] = [
    { price: entry, color: "rgba(34, 197, 94, 0.8)", label: `Entry ${entry.toFixed(2)}` },
  ];
  const stop = args.liveStop ?? args.saved?.stop ?? null;
  if (stop != null && stop > 0) {
    lines.push({ price: stop, color: "rgba(239, 68, 68, 0.8)", label: `Stop ${stop.toFixed(2)}` });
  }
  const target = args.liveTarget ?? args.saved?.target ?? null;
  if (target != null && target > 0) {
    lines.push({ price: target, color: "rgba(34, 197, 94, 0.6)", label: `Target ${target.toFixed(2)}` });
  }
  return lines;
}
