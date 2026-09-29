import { entryGaugeFromUnknown, type EntryGauge } from "@shared/entry-gauge";
import type { WatchlistColumnId } from "@/lib/watchlist-column-profile";

export function watchlistShowsEntryGauges(columns: { id: WatchlistColumnId }[]): boolean {
  return columns.some((c) => c.id === "vwapPct" || c.id === "ema620");
}

export function watchlistQuotesUrl(symbols: string[], opts: { extended?: boolean; gauges?: boolean }): string {
  const params = new URLSearchParams();
  if (symbols.length > 0) params.set("symbols", symbols.join(","));
  if (opts.extended) params.set("extended", "true");
  if (opts.gauges) params.set("gauges", "1");
  const qs = params.toString();
  return qs ? `/api/watchlist/quotes?${qs}` : "/api/watchlist/quotes";
}

export function gaugeFieldsFromQuote(row: object | null | undefined): EntryGauge {
  return entryGaugeFromUnknown((row ?? null) as Record<string, unknown> | null);
}

export function compareGaugePct(a: number | null | undefined, b: number | null | undefined): number {
  const av = a == null || Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a;
  const bv = b == null || Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b;
  return av - bv;
}
