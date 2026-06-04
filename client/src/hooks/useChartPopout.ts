import { useRef, useCallback } from 'react';

export function useChartPopout() {
  const windowRef = useRef<Window | null>(null);
  
  const syncToChart = useCallback((symbol: string) => {
    const sym = symbol.toUpperCase();
    const currentWindow = windowRef.current;

    if (currentWindow && !currentWindow.closed) {
      // Window exists - send message instead of navigating (no flash/reload)
      currentWindow.postMessage({ type: "SYMBOL_CHANGE", symbol: sym }, window.location.origin);
      currentWindow.focus();
      return;
    }

    const chartUrl = `/sentinel/charts?symbol=${sym}&popout=true`;
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
