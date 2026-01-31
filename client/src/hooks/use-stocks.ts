import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type ScannerRunInput } from "@shared/routes";

// GET /api/stocks/:symbol/history
export function useStockHistory(symbol: string) {
  return useQuery({
    queryKey: [api.stocks.history.path, symbol],
    queryFn: async () => {
      const url = buildUrl(api.stocks.history.path, { symbol });
      const res = await fetch(url);
      if (res.status === 404) throw new Error("Stock history not found");
      if (!res.ok) throw new Error("Failed to fetch history");
      return api.stocks.history.responses[200].parse(await res.json());
    },
    enabled: !!symbol,
  });
}

// GET /api/stocks/:symbol/quote
export function useStockQuote(symbol: string) {
  return useQuery({
    queryKey: [api.stocks.quote.path, symbol],
    queryFn: async () => {
      const url = buildUrl(api.stocks.quote.path, { symbol });
      const res = await fetch(url);
      if (res.status === 404) throw new Error("Quote not found");
      if (!res.ok) throw new Error("Failed to fetch quote");
      return api.stocks.quote.responses[200].parse(await res.json());
    },
    enabled: !!symbol,
    refetchInterval: 10000, // Live-ish updates
  });
}

// POST /api/scanner/run
export function useScanner() {
  return useMutation({
    mutationFn: async (filters: ScannerRunInput) => {
      const res = await fetch(api.scanner.run.path, {
        method: api.scanner.run.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      if (!res.ok) throw new Error("Scanner failed");
      return api.scanner.run.responses[200].parse(await res.json());
    },
  });
}
