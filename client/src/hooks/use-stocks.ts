import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type ScannerRunInput } from "@shared/routes";

const INTRADAY_INTERVALS = ['1m', '5m', '15m', '30m', '60m'] as const;

/** True when `useStockHistory` auto-refetches on an interval (every 60s). */
export function stockHistoryIsIntradayInterval(interval: string): boolean {
  return (INTRADAY_INTERVALS as readonly string[]).includes(interval);
}

/** Milliseconds between background refetches for intraday history (see `useStockHistory`). */
export const STOCK_HISTORY_INTRADAY_REFETCH_MS = 60_000;

// GET /api/stocks/:symbol/history
export function useStockHistory(symbol: string, interval: string = '1d') {
  return useQuery({
    queryKey: [api.stocks.history.path, symbol, interval],
    queryFn: async () => {
      const baseUrl = buildUrl(api.stocks.history.path, { symbol });
      const url = `${baseUrl}?interval=${interval}`;
      const res = await fetch(url);
      if (res.status === 404) throw new Error("Stock history not found");
      if (!res.ok) throw new Error("Failed to fetch history");
      return api.stocks.history.responses[200].parse(await res.json());
    },
    enabled: !!symbol,
    // Intraday: always treat as stale so refetchInterval actually fires a network request
    staleTime: stockHistoryIsIntradayInterval(interval) ? 0 : Infinity,
    // Re-poll intraday charts every minute to get the latest bar; daily+ don't need live refresh
    refetchInterval: stockHistoryIsIntradayInterval(interval) ? STOCK_HISTORY_INTRADAY_REFETCH_MS : false,
    refetchIntervalInBackground: stockHistoryIsIntradayInterval(interval), // keep 5m/15m/30m/60m updating every minute even when tab unfocused
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
