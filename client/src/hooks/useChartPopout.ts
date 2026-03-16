import { useRef, useCallback } from 'react';

export function useChartPopout() {
  const windowRef = useRef<Window | null>(null);
  
  const syncToChart = useCallback((symbol: string) => {
    const currentWindow = windowRef.current;
    
    if (currentWindow && !currentWindow.closed) {
      // Window exists - send message instead of navigating (no flash/reload)
      currentWindow.postMessage({ type: 'SYMBOL_CHANGE', symbol: symbol.toUpperCase() }, window.location.origin);
    } else {
      // Open NEW BROWSER WINDOW (not tab) with window features
      const chartUrl = `/sentinel/charts?symbol=${symbol}&popout=true`;
      windowRef.current = window.open(chartUrl, 'InternalCharts', 'width=1400,height=900,popup=yes');
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
