// ---------------------------------------------------------------------------
// Scanner Context — global provider for the Discovery Scanner
//
// Manages SSE connection, discovery feed state, scanner mode toggle,
// and unread badge count. Available from any page via useScanner().
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { DiscoveryCard, ScannerMode, ScannerStatus } from "@shared/scanner-types";

interface ScannerContextValue {
  /** Current scanner mode */
  mode: ScannerMode;
  setMode: (mode: ScannerMode) => void;

  /** Whether the overlay panel is visible */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;

  /** Live discovery feed (newest first) */
  discoveries: DiscoveryCard[];

  /** Unread count since last panel open */
  unreadCount: number;

  /** Clear unread counter (called when panel opens) */
  clearUnread: () => void;

  /** SSE connection status */
  connected: boolean;

  /** Scanner status from server */
  status: ScannerStatus | null;
}

const ScannerContext = createContext<ScannerContextValue>({
  mode: "on",
  setMode: () => {},
  panelOpen: false,
  setPanelOpen: () => {},
  discoveries: [],
  unreadCount: 0,
  clearUnread: () => {},
  connected: false,
  status: null,
});

export function useScanner() {
  return useContext(ScannerContext);
}

/** @deprecated Alias for legacy ScannerPage / SymbolPage compatibility */
export function useScannerContext() {
  return useContext(ScannerContext) as any;
}

/** @deprecated Alias for legacy SavedScansWidget / SymbolPage compatibility — returns null-safe wrapper */
export function useScannerContextSafe() {
  try {
    return useContext(ScannerContext) as any;
  } catch {
    return null;
  }
}

const MAX_FEED_SIZE = 200;

export function ScannerProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ScannerMode>(() => {
    try {
      return (localStorage.getItem("scanner_mode") as ScannerMode) || "on";
    } catch {
      return "on";
    }
  });

  const [panelOpen, setPanelOpenState] = useState(false);
  const [discoveries, setDiscoveries] = useState<DiscoveryCard[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<ScannerStatus | null>(null);

  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Mode setter (persists + sends to server) ────────────────────────────

  const setMode = useCallback((next: ScannerMode) => {
    setModeState(next);
    try {
      localStorage.setItem("scanner_mode", next);
    } catch { /* ignore */ }

    fetch("/api/scanner/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {});
  }, []);

  // ── Panel open/close ────────────────────────────────────────────────────

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenState(open);
    if (open) setUnreadCount(0);
  }, []);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  // ── SSE connection ──────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "off") {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setConnected(false);
      return;
    }

    const es = new EventSource("/api/scanner/stream");
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;

        const card = data as DiscoveryCard;
        setDiscoveries((prev) => {
          const next = [card, ...prev];
          return next.length > MAX_FEED_SIZE ? next.slice(0, MAX_FEED_SIZE) : next;
        });

        if (!panelOpenRef.current) {
          setUnreadCount((c) => c + 1);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [mode]);

  // ── Load history on mount ───────────────────────────────────────────────

  useEffect(() => {
    if (mode === "off") return;

    fetch("/api/scanner/history?limit=100")
      .then((r) => r.json())
      .then((data) => {
        if (data.discoveries?.length) {
          setDiscoveries(data.discoveries);
        }
      })
      .catch(() => {});
  }, [mode]);

  // ── Periodic status fetch ─────────────────────────────────────────────

  useEffect(() => {
    if (mode === "off") return;

    const fetchStatus = () => {
      fetch("/api/scanner/status")
        .then((r) => r.json())
        .then((s) => setStatus(s))
        .catch(() => {});
    };

    fetchStatus();
    const handle = setInterval(fetchStatus, 30_000);
    return () => clearInterval(handle);
  }, [mode]);

  return (
    <ScannerContext.Provider
      value={{
        mode,
        setMode,
        panelOpen,
        setPanelOpen,
        discoveries,
        unreadCount,
        clearUnread,
        connected,
        status,
      }}
    >
      {children}
    </ScannerContext.Provider>
  );
}
