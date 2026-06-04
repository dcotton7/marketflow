import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { ClusterId, MarketConditionData, TickerMetrics } from "@/hooks/useMarketCondition";
import {
  convertThemeMetricsToThemeRow,
  LIVE_THEME_BOX_REFETCH_MS,
  msUntilNextThemeBoxRefresh,
  type LiveThemeChartsConfig,
  type LiveThemeChartsSnapshotKey,
  uniqueSnapshotKeysForConfig,
} from "@/lib/live-theme-charts";
import type { ThemeRow } from "@/data/mockThemeData";
import type { ThemeMemberHighlight } from "@/lib/theme-member-highlights";
import { pickThemeMemberHighlights } from "@/lib/theme-member-highlights";

const API_BASE = "/api/market-condition";

async function fetchThemesForSnapshot(snapshotKey: LiveThemeChartsSnapshotKey): Promise<MarketConditionData> {
  const params = new URLSearchParams({ sizeFilter: "ALL" });
  if (snapshotKey === "live") {
    // Live ranks/scores with deltaRank vs prior stored 15m snapshot (not vs last 60s poll).
    params.set("timeSlice", "15M");
  } else {
    params.set("snapshotAt", snapshotKey);
  }
  const res = await fetch(`${API_BASE}/themes?${params}`);
  if (!res.ok) throw new Error("Failed to fetch themes");
  return res.json();
}

async function fetchThemeMembers(
  themeId: ClusterId,
  snapshotKey: LiveThemeChartsSnapshotKey
): Promise<{
  members: TickerMetrics[];
  accDistStats?: {
    total: number;
    accumulation3Plus: number;
    distribution3Plus: number;
    accumulationPct: number;
    distributionPct: number;
  };
}> {
  const params = new URLSearchParams();
  if (snapshotKey !== "live") {
    params.set("snapshotAt", snapshotKey);
  }
  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/themes/${themeId}/members?${qs}`
    : `${API_BASE}/themes/${themeId}/members`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch theme members");
  return res.json();
}

/** One themes fetch per unique snapshot baseline (not per column). */
export function useLiveThemeChartsThemeData(config: LiveThemeChartsConfig) {
  const snapshotKeys = useMemo(() => uniqueSnapshotKeysForConfig(config), [config]);

  const queries = useQueries({
    queries: snapshotKeys.map((snapshotKey) => ({
      queryKey: ["market-condition", "themes", "theme-charts", snapshotKey],
      queryFn: () => fetchThemesForSnapshot(snapshotKey),
      staleTime: LIVE_THEME_BOX_REFETCH_MS,
      refetchInterval:
        snapshotKey === "live"
          ? () => msUntilNextThemeBoxRefresh()
          : false,
      refetchOnWindowFocus: false,
    })),
  });

  const themesBySnapshot = useMemo(() => {
    const map = new Map<LiveThemeChartsSnapshotKey, ThemeRow[]>();
    snapshotKeys.forEach((key, idx) => {
      const data = queries[idx]?.data;
      map.set(key, (data?.themes ?? []).map(convertThemeMetricsToThemeRow));
    });
    return map;
  }, [queries, snapshotKeys]);

  const comparisonTimeBySnapshot = useMemo(() => {
    const map = new Map<LiveThemeChartsSnapshotKey, string | null>();
    snapshotKeys.forEach((key, idx) => {
      map.set(key, queries[idx]?.data?.comparisonTime ?? null);
    });
    return map;
  }, [queries, snapshotKeys]);

  const isLoading = queries.some((q) => q.isLoading && !q.data);
  const error = queries.find((q) => q.error)?.error ?? null;

  return { themesBySnapshot, comparisonTimeBySnapshot, isLoading, error };
}

/** Member highlights + A/D stats for one column — fetched once, no polling. */
export function useThemeColumnMemberHighlights(
  themes: ThemeRow[],
  snapshotKey: LiveThemeChartsSnapshotKey,
  enabled: boolean
) {
  const themeIds = useMemo(() => themes.map((t) => t.id as ClusterId), [themes]);

  const queries = useQueries({
    queries: themeIds.map((themeId) => ({
      queryKey: ["market-condition", "members", "theme-charts", themeId, snapshotKey],
      queryFn: () => fetchThemeMembers(themeId, snapshotKey),
      enabled: enabled && themeIds.length > 0,
      staleTime: LIVE_THEME_BOX_REFETCH_MS,
      refetchInterval:
        snapshotKey === "live" ? () => msUntilNextThemeBoxRefresh() : false,
      refetchOnWindowFocus: false,
    })),
  });

  return useMemo(() => {
    const highlightsByThemeId = new Map<string, ThemeMemberHighlight[]>();
    const accDistStatsByThemeId = new Map<
      string,
      {
        total: number;
        accumulation3Plus: number;
        distribution3Plus: number;
        accumulationPct: number;
        distributionPct: number;
      } | null
    >();
    themeIds.forEach((id, idx) => {
      const theme = themes.find((t) => t.id === id);
      const data = queries[idx]?.data;
      const members = data?.members ?? [];
      highlightsByThemeId.set(id, theme ? pickThemeMemberHighlights(members, theme, 4) : []);
      accDistStatsByThemeId.set(id, data?.accDistStats ?? null);
    });
    return { highlightsByThemeId, accDistStatsByThemeId };
  }, [queries, themeIds, themes]);
}
