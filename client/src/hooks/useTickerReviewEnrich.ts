import { useCallback, useRef } from "react";
import type { TickerReviewResultRow } from "@/lib/ticker-review-engine";
import { resolveTradingDayKey } from "@shared/theme-daily-watchlist";

export interface TickerReviewEnrichEntry {
  decisionBrief: string;
  invalidation: string;
  source?: string;
}

export function useTickerReviewEnrich(themeId: string | null) {
  const cacheRef = useRef<Map<string, TickerReviewEnrichEntry>>(new Map());
  const tradingDayKey = resolveTradingDayKey();

  const enrichBatch = useCallback(
    async (
      symbols: string[],
      rows: TickerReviewResultRow[],
      themeRank?: number
    ): Promise<Record<string, TickerReviewEnrichEntry>> => {
      const out: Record<string, TickerReviewEnrichEntry> = {};
      const missing: string[] = [];

      for (const sym of symbols) {
        const key = `${themeId ?? "none"}:${tradingDayKey}:${sym}`;
        const cached = cacheRef.current.get(key);
        if (cached) {
          out[sym] = cached;
        } else {
          missing.push(sym);
        }
      }

      if (!missing.length || !themeId) return out;

      const res = await fetch(`/api/market-condition/themes/${themeId}/ticker-review/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          symbols: missing,
          rows: rows.filter((r) => missing.includes(r.symbol.toUpperCase())),
          themeRank,
        }),
      });

      if (!res.ok) throw new Error("Enrich failed");

      const data = await res.json();
      const enriched = data.enriched ?? {};
      for (const sym of missing) {
        const hit = enriched[sym];
        if (hit) {
          const entry: TickerReviewEnrichEntry = {
            decisionBrief: hit.decisionBrief,
            invalidation: hit.invalidation,
            source: hit.source,
          };
          const key = `${themeId}:${tradingDayKey}:${sym}`;
          cacheRef.current.set(key, entry);
          out[sym] = entry;
        }
      }

      return out;
    },
    [themeId, tradingDayKey]
  );

  return { enrichBatch, tradingDayKey };
}
