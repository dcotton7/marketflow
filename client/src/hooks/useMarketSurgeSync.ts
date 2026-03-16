import { useRef, useCallback } from 'react';

export type MSPeriodicity = 'day' | 'week' | 'month';

export function useMarketSurgeSync() {
  const windowRef = useRef<Window | null>(null);
  
  const syncToMarketSurge = useCallback((symbol: string, periodicity: MSPeriodicity = 'day') => {
    const chartParam = encodeURIComponent(`symbol:${symbol},periodicity:${periodicity}`);
    const msUrl = `https://marketsurge-beta.investors.com/mstool?chart=${chartParam}`;
    
    const currentWindow = windowRef.current;
    
    if (currentWindow && !currentWindow.closed) {
      // Window exists and is open - just navigate it to new symbol
      currentWindow.location.href = msUrl;
    } else {
      // Open NEW BROWSER WINDOW (not tab) with window features
      windowRef.current = window.open(msUrl, 'MarketSurge', 'width=1920,height=1080,popup=yes');
    }
  }, []);
  
  const closeMarketSurge = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
      windowRef.current = null;
    }
  }, []);
  
  const isMarketSurgeOpen = useCallback(() => {
    return windowRef.current !== null && !windowRef.current.closed;
  }, []);
  
  return { 
    syncToMarketSurge, 
    closeMarketSurge, 
    isMarketSurgeOpen 
  };
}
