import { useRef, useCallback } from "react";

/**
 * Opens and syncs the Detailed Analysis report in a separate window (detachable).
 * Mirror of useChartPopout / useMarketSurgeSync.
 */
export function useAnalysisPopout() {
  const windowRef = useRef<Window | null>(null);

  const openAnalysisPopout = useCallback((symbol: string): boolean => {
    const currentWindow = windowRef.current;
    const origin = window.location.origin;

    if (currentWindow && !currentWindow.closed) {
      currentWindow.postMessage(
        { type: "SYMBOL_CHANGE", symbol: symbol.toUpperCase() },
        origin
      );
      currentWindow.focus();
      return true;
    }
    const url = `/sentinel/analysis?symbol=${encodeURIComponent(symbol.toUpperCase())}&popout=true`;
    const w = window.open(url, "AnalysisPopout", "width=900,height=800,popup=yes");
    if (w) {
      windowRef.current = w;
      return true;
    }
    return false;
  }, []);

  const syncToAnalysis = useCallback((symbol: string) => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.postMessage(
        { type: "SYMBOL_CHANGE", symbol: symbol.toUpperCase() },
        window.location.origin
      );
    }
  }, []);

  const closeAnalysisPopout = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
      windowRef.current = null;
    }
  }, []);

  return {
    openAnalysisPopout,
    syncToAnalysis,
    closeAnalysisPopout,
  };
}
