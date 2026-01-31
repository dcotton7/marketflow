import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertWatchlistItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useWatchlist() {
  return useQuery({
    queryKey: [api.watchlist.list.path],
    queryFn: async () => {
      const res = await fetch(api.watchlist.list.path);
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return api.watchlist.list.responses[200].parse(await res.json());
    },
  });
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertWatchlistItem) => {
      const res = await fetch(api.watchlist.add.path, {
        method: api.watchlist.add.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to add to watchlist");
      }
      return api.watchlist.add.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.watchlist.list.path] });
      toast({ title: "Added to watchlist", description: "Symbol is now being tracked." });
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
    mutationFn: async (id: number) => {
      const url = buildUrl(api.watchlist.delete.path, { id });
      const res = await fetch(url, { method: api.watchlist.delete.method });
      if (!res.ok) throw new Error("Failed to remove from watchlist");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.watchlist.list.path] });
      toast({ title: "Removed", description: "Symbol removed from watchlist." });
    },
  });
}
