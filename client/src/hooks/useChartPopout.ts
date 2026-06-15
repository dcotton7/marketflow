import { useRef, useCallback } from 'react';

export type ChartPopoutOptions = {
  /** Ordered symbol queue for prev/next in the popout charts window (e.g. Ticker Review). */
  symOrder?: string[];
};

function buildChartPopoutUrl(symbol: string, options?: ChartPopoutOptions): string {
  const sym = symbol.toUpperCase();
  const params = new URLSearchParams({ symbol: sym, popout: "true" });
  const order = options?.symOrder?.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (order?.length) {
    params.set("source", "tickerReview");
    params.set("symOrder", order.join(","));
  }
  return `/sentinel/charts?${params.toString()}`;
}

export function useChartPopout() {
  const windowRef = useRef<Window | null>(null);
  
  const syncToChart = useCallback((symbol: string, options?: ChartPopoutOptions) => {
    const sym = symbol.toUpperCase();
    const currentWindow = windowRef.current;

    const order = options?.symOrder?.map((s) => s.trim().toUpperCase()).filter(Boolean);

    if (currentWindow && !currentWindow.closed) {
      // Window exists - send message instead of navigating (no flash/reload)
      if (order?.length) {
        currentWindow.postMessage(
          { type: "QUEUE_UPDATE", symOrder: order, symbol: sym },
          window.location.origin
        );
      } else {
        currentWindow.postMessage({ type: "SYMBOL_CHANGE", symbol: sym }, window.location.origin);
      }
      currentWindow.focus();
      return;
    }

    const chartUrl = buildChartPopoutUrl(sym, options);
    const w = window.open(chartUrl, "InternalCharts", "width=1400,height=900,popup=yes");
    if (w) {
      windowRef.current = w;
      w.focus();
    }
  }, []);
  
  const closeChart = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
      windowRef.current = null;
    }
  }, []);
  
  const isChartOpen = useCallback(() => {
    return windowRef.current !== null && !windowRef.current.closed;
  }, []);
  
  return { 
    syncToChart, 
    closeChart, 
    isChartOpen 
  };
}
