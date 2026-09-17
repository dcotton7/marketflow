import { useCallback, useRef } from "react";
import { openAppPopout } from "@/lib/app-popout";
import {
  INFOPOP_CHANNEL,
  INFOPOP_STORAGE_KEY,
  INFOPOP_WINDOW_NAME,
  type InfoPopMessage,
} from "@/components/infopop/infopop-channel";

const INFOPOP_SIZE = { width: 300, height: 480 };

export function useInfoPop() {
  const windowRef = useRef<Window | null>(null);

  const openInfoPop = useCallback((watchlistId?: number | null) => {
    const qs =
      typeof watchlistId === "number" && Number.isFinite(watchlistId)
        ? `?watchlistId=${watchlistId}`
        : "";
    const w = openAppPopout(
      `/infopop${qs}`,
      INFOPOP_WINDOW_NAME,
      INFOPOP_SIZE,
      windowRef.current
    );
    if (w) {
      windowRef.current = w;
      try {
        localStorage.setItem(INFOPOP_STORAGE_KEY, "true");
      } catch {
        /* ignore */
      }
    }
    return w;
  }, []);

  const dockInfoPop = useCallback(() => {
    if (windowRef.current && !windowRef.current.closed) {
      windowRef.current.close();
    }
    windowRef.current = null;
    try {
      const ch = new BroadcastChannel(INFOPOP_CHANNEL);
      ch.postMessage({ type: "INFOPOP_DOCK_REQUEST" } satisfies InfoPopMessage);
      ch.close();
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(INFOPOP_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { openInfoPop, dockInfoPop };
}
