import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildDailyWatchlistName,
  encodeThemeReviewThesis,
  getMarketSessionEt,
  resolveTradingDayKey,
  type MarketSessionKind,
} from "@shared/theme-daily-watchlist";
import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";
import {
  useWatchlists,
  useNamedWatchlistItems,
  type Watchlist,
} from "@/hooks/use-watchlist";

async function apiCreateWatchlist(name: string): Promise<Watchlist> {
  const res = await fetch("/api/sentinel/watchlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create watchlist");
  }
  return res.json();
}

async function apiAddWatchlistItem(data: {
  symbol: string;
  watchlistId: number;
  thesis?: string;
}): Promise<{ id: number }> {
  const res = await fetch("/api/sentinel/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ symbol: data.symbol, watchlistId: data.watchlistId, priority: "medium", thesis: data.thesis }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to add to watchlist");
  }
  return res.json();
}

async function apiRemoveWatchlistItem(id: number): Promise<void> {
  const res = await fetch(`/api/sentinel/watchlist/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to remove from watchlist");
}

async function apiUpdateWatchlistItem(id: number, thesis: string): Promise<void> {
  const res = await fetch(`/api/sentinel/watchlist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ thesis }),
  });
  if (!res.ok) throw new Error("Failed to update watchlist item");
}

export function useThemeDailyWatchlist(
  themeName: string | null,
  marketSession?: MarketSessionKind
) {
  const queryClient = useQueryClient();
  const { data: watchlists } = useWatchlists();
  const session = marketSession ?? getMarketSessionEt();
  const tradingDayKey = useMemo(() => resolveTradingDayKey(session), [session]);
  const dailyListName = useMemo(
    () => (themeName ? buildDailyWatchlistName(themeName, tradingDayKey) : null),
    [themeName, tradingDayKey]
  );

  const dailyWatchlist = useMemo(
    () => watchlists?.find((w) => w.name === dailyListName) ?? null,
    [watchlists, dailyListName]
  );

  const { data: dailyItems } = useNamedWatchlistItems(dailyWatchlist?.id ?? null);

  const ensureDailyWatchlist = useCallback(async (): Promise<number> => {
    if (!dailyListName) throw new Error("No theme name");
    const existing = watchlists?.find((w) => w.name === dailyListName);
    if (existing) return existing.id;
    const created = await apiCreateWatchlist(dailyListName);
    await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
    return created.id;
  }, [dailyListName, watchlists, queryClient]);

  const syncStar = useCallback(
    async (row: TickerReviewResultRow, starred: boolean) => {
      if (!dailyListName) return;
      const sym = row.symbol.toUpperCase();
      const watchlistId = await ensureDailyWatchlist();
      const items = dailyItems ?? [];
      const existing = items.find((i) => i.symbol.toUpperCase() === sym);

      if (starred) {
        const thesis = encodeThemeReviewThesis({
          v: 1,
          tradingDayKey,
          row,
          starredAt: new Date().toISOString(),
        });
        if (existing) {
          await apiUpdateWatchlistItem(existing.id, thesis);
        } else {
          await apiAddWatchlistItem({ symbol: sym, watchlistId, thesis });
        }
      } else if (existing) {
        await apiRemoveWatchlistItem(existing.id);
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist", watchlistId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
    },
    [dailyListName, dailyItems, ensureDailyWatchlist, tradingDayKey, queryClient]
  );

  const starredSymbolsFromWatchlist = useMemo(() => {
    const set = new Set<string>();
    for (const item of dailyItems ?? []) {
      set.add(item.symbol.toUpperCase());
    }
    return set;
  }, [dailyItems]);

  return {
    dailyListName,
    tradingDayKey,
    dailyWatchlistId: dailyWatchlist?.id ?? null,
    starredSymbolsFromWatchlist,
    syncStar,
  };
}
