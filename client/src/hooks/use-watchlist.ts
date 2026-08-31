import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useCallback, useEffect, useMemo } from "react";

// Watchlist definition (the named list itself)
export interface Watchlist {
  id: number;
  userId: number;
  name: string;
  isDefault: boolean;
  isPortfolio?: boolean;
  itemCount?: number;
  createdAt: string;
}

// Sentinel Watchlist Item type (items within a watchlist)
export interface SentinelWatchlistItem {
  id: number;
  userId: number;
  watchlistId?: number;
  symbol: string;
  direction?: string;
  targetEntry?: number;
  stopPlan?: number;
  targetPlan?: number;
  alertPrice?: number;
  thesis?: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  ivyEvalId?: number;
  ivyEvalText?: string;
  ivyRecommendedEntry?: number;
  ivyRecommendedStop?: number;
  ivyRecommendedTarget?: number;
  ivyRiskAssessment?: string;
}

/** Last-used watchlist — shared across Charts, Manager, MarketFlow, Big Idea, header */
export const WATCHLIST_MANAGER_STORAGE_KEY = "watchlistModalSelectedId";
export const LAST_USED_WATCHLIST_STORAGE_KEY = WATCHLIST_MANAGER_STORAGE_KEY;

/** Older per-page keys migrated into LAST_USED_WATCHLIST_STORAGE_KEY on first read */
const LEGACY_WATCHLIST_STORAGE_KEYS = [
  "standaloneWatchlistId",
  "scanWatchlistId",
  "sidebarWatchlistId",
  "selectedWatchlistId",
] as const;

function readWatchlistIdFromStorage(storageKey: string): number | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(storageKey);
  if (stored == null || stored === "") return null;
  const n = parseInt(stored, 10);
  return Number.isFinite(n) ? n : null;
}

/** Read last-used id, migrating legacy keys when the primary key is empty. */
export function readLastUsedWatchlistId(
  storageKey: string = LAST_USED_WATCHLIST_STORAGE_KEY
): number | null {
  const primary = readWatchlistIdFromStorage(storageKey);
  if (primary != null) return primary;

  if (typeof window === "undefined") return null;

  for (const legacyKey of LEGACY_WATCHLIST_STORAGE_KEYS) {
    if (legacyKey === storageKey) continue;
    const legacyId = readWatchlistIdFromStorage(legacyKey);
    if (legacyId != null) {
      localStorage.setItem(storageKey, String(legacyId));
      localStorage.removeItem(legacyKey);
      return legacyId;
    }
  }
  return null;
}

/** Resolve persisted id to a valid watchlist id (falls back to default / first list). */
export function resolveEffectiveWatchlistId(
  selectedId: number | null | undefined,
  watchlists: Watchlist[] | undefined
): number | null {
  if (selectedId != null && watchlists?.some((w) => w.id === selectedId)) {
    return selectedId;
  }
  return watchlists?.find((wl) => wl.isDefault)?.id ?? watchlists?.[0]?.id ?? null;
}

/** Last-used watchlist id + setter; persists to localStorage across sessions. */
export function useLastUsedWatchlistId() {
  return useSelectedWatchlistId(LAST_USED_WATCHLIST_STORAGE_KEY);
}

/** Selected id resolved against loaded lists; auto-persists fallback when nothing stored. */
export function useEffectiveWatchlistId() {
  const { data: watchlists, isLoading } = useWatchlists();
  const [selectedId, setSelectedId] = useLastUsedWatchlistId();

  const effectiveId = useMemo(
    () => resolveEffectiveWatchlistId(selectedId, watchlists),
    [selectedId, watchlists]
  );

  useEffect(() => {
    if (selectedId == null && effectiveId != null) {
      setSelectedId(effectiveId);
    }
  }, [selectedId, effectiveId, setSelectedId]);

  const selectedWatchlist = watchlists?.find((wl) => wl.id === effectiveId) ?? null;

  return {
    watchlists,
    isLoading,
    selectedId: effectiveId,
    selectedWatchlist,
    setSelectedId,
  };
}

// Hook to manage selected watchlist ID with localStorage persistence
export function useSelectedWatchlistId(storageKey: string = LAST_USED_WATCHLIST_STORAGE_KEY) {
  const [selectedId, setSelectedId] = useState<number | null>(() =>
    storageKey === LAST_USED_WATCHLIST_STORAGE_KEY
      ? readLastUsedWatchlistId(storageKey)
      : readWatchlistIdFromStorage(storageKey)
  );

  useEffect(() => {
    const next =
      storageKey === LAST_USED_WATCHLIST_STORAGE_KEY
        ? readLastUsedWatchlistId(storageKey)
        : readWatchlistIdFromStorage(storageKey);
    setSelectedId(next);
  }, [storageKey]);

  const setSelected = useCallback(
    (id: number | null) => {
      setSelectedId(id);
      if (id === null) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, String(id));
      }
    },
    [storageKey]
  );

  return [selectedId, setSelected] as const;
}

// Fetch all watchlist definitions for the user
export function useWatchlists() {
  return useQuery<Watchlist[]>({
    queryKey: ["/api/sentinel/watchlists"],
    queryFn: async () => {
      const res = await fetch("/api/sentinel/watchlists", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlists");
      return res.json();
    },
  });
}

// Create a new watchlist
export function useCreateWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/sentinel/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to create watchlist" }));
        throw new Error(error.error || "Failed to create watchlist");
      }
      return res.json() as Promise<Watchlist>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
      toast({ title: "Watchlist Created" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// Rename a watchlist
export function useRenameWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      isPortfolio,
    }: {
      id: number;
      name?: string;
      isPortfolio?: boolean;
    }) => {
      const payload: { name?: string; isPortfolio?: boolean } = {};
      if (name != null) payload.name = name;
      if (isPortfolio != null) payload.isPortfolio = isPortfolio;
      const res = await fetch(`/api/sentinel/watchlists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to rename watchlist" }));
        throw new Error(error.error || "Failed to rename watchlist");
      }
      return res.json() as Promise<Watchlist>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
      toast({ title: "Watchlist Updated" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// Delete a watchlist (items are moved to default)
export function useDeleteWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/sentinel/watchlists/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to delete watchlist" }));
        throw new Error(error.error || "Failed to delete watchlist");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      toast({ title: "Watchlist Deleted", description: "Items moved to Default watchlist." });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// Set a watchlist as default
export function useSetDefaultWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/sentinel/watchlists/${id}/set-default`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to set default" }));
        throw new Error(error.error || "Failed to set default");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
      toast({ title: "Default Watchlist Updated" });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

// Fetch watchlist items (optionally filtered by watchlistId). Omit id to load all items (legacy / full merge).
export function useWatchlist(watchlistId?: number | null) {
  return useQuery<SentinelWatchlistItem[]>({
    queryKey: ["/api/sentinel/watchlist", watchlistId ?? "all"],
    queryFn: async () => {
      const url = watchlistId != null
        ? `/api/sentinel/watchlist?watchlistId=${watchlistId}`
        : "/api/sentinel/watchlist";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return res.json();
    },
  });
}

/** One named list only; skips fetch until watchlistId is set (avoids merged “all lists” payload). */
export function useNamedWatchlistItems(watchlistId: number | null | undefined) {
  return useQuery<SentinelWatchlistItem[]>({
    queryKey: ["/api/sentinel/watchlist", watchlistId],
    queryFn: async () => {
      const res = await fetch(`/api/sentinel/watchlist?watchlistId=${watchlistId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return res.json();
    },
    enabled: typeof watchlistId === "number" && !Number.isNaN(watchlistId),
  });
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { symbol: string; watchlistId?: number; priority?: string }) => {
      const res = await fetch("/api/sentinel/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          symbol: data.symbol,
          watchlistId: data.watchlistId,
          priority: data.priority || "medium"
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to add to watchlist" }));
        throw new Error(error.error || "Failed to add to watchlist");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      if (variables.watchlistId != null) {
        queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist", variables.watchlistId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await fetch(`/api/sentinel/watchlist/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove from watchlist");
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/sentinel/watchlist"], exact: false });

      const queryCache = queryClient.getQueryCache();
      const watchlistQueries = queryCache.findAll({ queryKey: ["/api/sentinel/watchlist"] });
      const previousData = new Map<string, SentinelWatchlistItem[]>();

      for (const query of watchlistQueries) {
        const items = queryClient.getQueryData<SentinelWatchlistItem[]>(query.queryKey);
        if (items) {
          previousData.set(JSON.stringify(query.queryKey), items);
          queryClient.setQueryData(query.queryKey, items.filter((item) => item.id !== id));
        }
      }
      return { previousData };
    },
    onSuccess: () => {
      toast({ title: "Removed", description: "Symbol removed from Watching List." });
    },
    onError: (err, _vars, context) => {
      if (context?.previousData) {
        for (const [keyStr, items] of context.previousData) {
          queryClient.setQueryData(JSON.parse(keyStr), items);
        }
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
    },
  });
}

export function useUpdateWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { 
      id: number; 
      data: { 
        targetEntry?: number | null; 
        stopPlan?: number | null; 
        targetPlan?: number | null;
        thesis?: string;
        priority?: string;
      } 
    }) => {
      const res = await fetch(`/api/sentinel/watchlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to update watchlist" }));
        throw new Error(error.error || "Failed to update watchlist");
      }
      return res.json();
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches for all watchlist queries
      await queryClient.cancelQueries({ queryKey: ["/api/sentinel/watchlist"], exact: false });
      
      // Get all cached watchlist queries and update them optimistically
      const queryCache = queryClient.getQueryCache();
      const watchlistQueries = queryCache.findAll({ queryKey: ["/api/sentinel/watchlist"] });
      
      const previousData: Map<string, SentinelWatchlistItem[]> = new Map();
      
      for (const query of watchlistQueries) {
        const queryKey = query.queryKey;
        const items = queryClient.getQueryData<SentinelWatchlistItem[]>(queryKey);
        if (items) {
          previousData.set(JSON.stringify(queryKey), items);
          queryClient.setQueryData<SentinelWatchlistItem[]>(queryKey, 
            items.map(item => 
              item.id === id 
                ? { ...item, ...data } 
                : item
            )
          );
        }
      }
      
      return { previousData };
    },
    onError: (err, _variables, context) => {
      // Rollback all on error
      if (context?.previousData) {
        for (const [keyStr, items] of context.previousData) {
          queryClient.setQueryData(JSON.parse(keyStr), items);
        }
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
    },
  });
}

export function useAddToWatchlistWithTradePlan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { 
      symbol: string; 
      watchlistId?: number;
      targetEntry?: number;
      stopPlan?: number;
      targetPlan?: number;
      thesis?: string;
      priority?: string;
      ivyEvalText?: string;
      ivyRecommendedEntry?: number;
      ivyRecommendedStop?: number;
      ivyRecommendedTarget?: number;
      ivyRiskAssessment?: string;
    }) => {
      const res = await fetch("/api/sentinel/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          symbol: data.symbol,
          watchlistId: data.watchlistId,
          targetEntry: data.targetEntry,
          stopPlan: data.stopPlan,
          targetPlan: data.targetPlan,
          thesis: data.thesis,
          priority: data.priority || "medium",
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to add to watchlist" }));
        throw new Error(error.error || "Failed to add to watchlist");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      toast({ title: "Added to Watchlist", description: "Symbol and trade plan saved." });
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

export function useBulkAddToWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { symbols: string[]; watchlistId: number }) => {
      const results = await Promise.allSettled(
        data.symbols.map(symbol =>
          fetch("/api/sentinel/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ 
              symbol,
              watchlistId: data.watchlistId,
              priority: "medium"
            }),
          }).then(res => {
            if (!res.ok) throw new Error(`Failed to add ${symbol}`);
            return res.json();
          })
        )
      );
      
      const succeeded = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;
      
      return { succeeded, failed, total: data.symbols.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      if (result.failed > 0) {
        toast({ 
          title: "Partially Added", 
          description: `Added ${result.succeeded} of ${result.total} symbols. ${result.failed} failed (may already exist).`
        });
      } else {
        toast({ 
          title: "Added to Watchlist", 
          description: `${result.succeeded} symbols added.` 
        });
      }
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}
