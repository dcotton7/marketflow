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

  /** True when push stream is open (or briefly reconnecting). Not the same as mode Active. */
  connected: boolean;

  /** Push-stream state — red icon means stream, not scanner Off */
  streamStatus: "live" | "reconnecting" | "offline";

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
  streamStatus: "offline",
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
  const [streamStatus, setStreamStatus] = useState<"live" | "reconnecting" | "offline">("offline");
  const connected = streamStatus === "live" || streamStatus === "reconnecting";
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

  // ── SSE connection (push stream — independent of Active/Silent/Off mode label) ──

  useEffect(() => {
    if (mode === "off") {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setStreamStatus("offline");
      return;
    }

    const es = new EventSource("/api/scanner/stream");
    eventSourceRef.current = es;

    es.onopen = () => setStreamStatus("live");

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Any traffic (hello / ping / card) means the stream is up
        setStreamStatus("live");
        if (data.type === "connected" || data.type === "ping") return;

        // Setup invalidated (e.g. LOD bounce gave up or extended too far)
        if (data.type === "discovery_clear") {
          const cardIds = new Set<number>(
            Array.isArray(data.cardIds) ? data.cardIds : []
          );
          const subject = typeof data.subject === "string" ? data.subject : null;
          const signalType = typeof data.signalType === "string" ? data.signalType : null;
          setDiscoveries((prev) =>
            prev.filter((c) => {
              if (cardIds.has(c.id)) return false;
              if (subject && signalType && c.subject === subject && c.signalType === signalType) {
                return false;
              }
              return true;
            })
          );
          return;
        }

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
      // Browser auto-reconnects while CONNECTING — don't show hard-offline red for that.
      if (es.readyState === EventSource.CLOSED) setStreamStatus("offline");
      else setStreamStatus("reconnecting");
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setStreamStatus("offline");
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
        streamStatus,
        status,
      }}
    >
      {children}
    </ScannerContext.Provider>
  );
}
