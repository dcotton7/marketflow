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

/** Right-axis Entry box: `Entry 58.98  +4.90%` vs live last. */
export function formatTradePlanEntryLabel(entry: number, currentPrice?: number | null): string {
  const base = `Entry ${entry.toFixed(2)}`;
  if (currentPrice == null || !Number.isFinite(currentPrice) || !(entry > 0)) return base;
  const pct = ((currentPrice - entry) / entry) * 100;
  if (!Number.isFinite(pct)) return base;
  const sign = pct >= 0 ? "+" : "";
  return `${base}  ${sign}${pct.toFixed(2)}%`;
}

export function applyLiveEntryPctToPriceLines<T extends { price: number; label: string }>(
  lines: T[],
  currentPrice?: number | null,
): T[] {
  if (!lines.length) return lines;
  return lines.map((pl) => {
    if (!/^Entry\b/i.test(pl.label.trim())) return pl;
    return { ...pl, label: formatTradePlanEntryLabel(pl.price, currentPrice) };
  });
}

/**
 * Chart lines are lite: entry first. Stop/target only if an entry exists.
 * Live overlay values win; otherwise the watchlist saved plan.
 */
export function buildWatchlistTradePlanLines(args: {
  liveEntry?: number | null;
  liveStop?: number | null;
  liveTarget?: number | null;
  currentPrice?: number | null;
  saved?: { entry?: number | null; stop?: number | null; target?: number | null } | null;
}): TradePlanPriceLine[] {
  if (!isTradePlanEnabled()) return [];
  const entry = args.liveEntry ?? args.saved?.entry ?? null;
  if (entry == null || !(entry > 0)) return [];
  const lines: TradePlanPriceLine[] = [
    { price: entry, color: "rgba(34, 197, 94, 0.8)", label: formatTradePlanEntryLabel(entry, args.currentPrice) },
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
