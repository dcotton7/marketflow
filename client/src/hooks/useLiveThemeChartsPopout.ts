import { useRef, useCallback } from "react";

export type LiveThemeChartsPopoutParams = {
  instanceId: string;
  startId?: string;
};

/**
 * Opens Live Theme Charts in a separate browser window (movable to another monitor).
 * Same pattern as useChartPopout / useAnalysisPopout.
 */
export function useLiveThemeChartsPopout() {
  const windowRef = useRef<Window | null>(null);

  const openLiveThemeChartsPopout = useCallback((params: LiveThemeChartsPopoutParams): boolean => {
    const currentWindow = windowRef.current;

    if (currentWindow && !currentWindow.closed) {
      currentWindow.focus();
      return true;
    }

    const qs = new URLSearchParams({
      popout: "true",
      instanceId: params.instanceId,
    });
    if (params.startId) {
      qs.set("startId", params.startId);
    }

    const url = `/sentinel/live-theme-charts?${qs}`;
    const w = window.open(url, "LiveThemeChartsPopout", "width=1400,height=900,popup=yes");
    if (w) {
      windowRef.current = w;
      return true;
    }
    return false;
  }, []);

  const isPopoutOpen = useCallback((): boolean => {
    return windowRef.current !== null && !windowRef.current.closed;
  }, []);

  const closePopout = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
    }
    windowRef.current = null;
  }, []);

  return {
    openLiveThemeChartsPopout,
    isPopoutOpen,
    closePopout,
    windowRef,
  };
}
