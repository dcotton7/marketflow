import { useMutation } from "@tanstack/react-query";
import type {
  OptionalCriterionId,
  RaiLabel,
  RequiredCriterionId,
  TickerReviewScanMode,
} from "@shared/ticker-review-types";
import type { TickerReviewResultRow } from "@shared/ticker-review-engine";
import { runTickerReviewScan } from "@/lib/ticker-review-engine";
import type { TickerRow } from "@/data/mockThemeData";

export interface TickerReviewScanParams {
  themeId: string | null;
  tickers: TickerRow[];
  themeMedianPct?: number;
  themeRank?: number;
  raiLabel?: RaiLabel;
  mode: TickerReviewScanMode;
  enabledRequired: Set<RequiredCriterionId>;
  enabledOptional: Set<OptionalCriterionId>;
  scope?: "theme" | "leaders" | "subtheme";
  maxResults?: number;
}

export interface TickerReviewScanResponse {
  results: TickerReviewResultRow[];
  hiddenCount: number;
  effectiveMode: string;
  hvcEnriched?: boolean;
  patternEnriched?: boolean;
  warnings?: string[];
  scanError?: string;
}

/** Server scan with bar-backed patterns; falls back to client metrics if API fails. */
export function useTickerReviewScan() {
  return useMutation({
    mutationFn: async (params: TickerReviewScanParams): Promise<TickerReviewScanResponse> => {
      if (!params.tickers.length) {
        return { results: [], hiddenCount: 0, effectiveMode: params.mode, hvcEnriched: false };
      }

      if (params.themeId) {
        try {
          const res = await fetch(`/api/market-condition/themes/${params.themeId}/ticker-review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              mode: params.mode,
              enabledRequired: [...params.enabledRequired],
              enabledOptional: [...params.enabledOptional],
              raiLabel: params.raiLabel,
              themeRank: params.themeRank,
              themeMedianPct: params.themeMedianPct,
              maxResults: params.maxResults ?? 10,
              scope: params.scope === "leaders" ? "leaders" : "theme",
            }),
          });
          if (res.ok) {
            const data = await res.json();
            return {
              results: data.results ?? [],
              hiddenCount: data.hiddenCount ?? 0,
              effectiveMode: data.effectiveMode ?? data.scanMode ?? params.mode,
              hvcEnriched: data.dataQuality?.hvcEnriched ?? false,
              patternEnriched: data.dataQuality?.patternEnriched ?? false,
              warnings: data.dataQuality?.warnings,
            };
          }
        } catch {
          /* fall through to client scan */
        }
      }

      try {
        const local = runTickerReviewScan({
          tickers: params.tickers,
          themeMedianPct: params.themeMedianPct,
          mode: params.mode,
          enabledRequired: params.enabledRequired,
          enabledOptional: params.enabledOptional,
          raiLabel: params.raiLabel,
          themeRank: params.themeRank,
          maxResults: params.maxResults ?? 10,
        });
        return {
          results: local.results,
          hiddenCount: local.hiddenCount,
          effectiveMode: local.effectiveMode,
          hvcEnriched: false,
          patternEnriched: false,
          warnings: ["Client-side scan — pattern detection limited without server bars"],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Scan failed";
        return {
          results: [],
          hiddenCount: params.tickers.length,
          effectiveMode: params.mode,
          hvcEnriched: false,
          scanError: msg,
        };
      }
    },
  });
}
