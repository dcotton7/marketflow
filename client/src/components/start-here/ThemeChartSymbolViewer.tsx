import { TickerReviewChartViewer } from "@/components/market-condition/TickerReviewChartViewer";

/**
 * Full-screen Sentinel dual charts opened from Live Theme Charts member chip.
 * Reuses Ticker Review chart viewer + load status pipeline (no scan enrich).
 */
export function ThemeChartSymbolViewer({
  symbol,
  onClose,
}: {
  symbol: string | null;
  onClose: () => void;
}) {
  const sym = symbol?.trim().toUpperCase() ?? "";
  return (
    <TickerReviewChartViewer
      open={!!sym}
      symbols={sym ? [sym] : []}
      onClose={onClose}
    />
  );
}
