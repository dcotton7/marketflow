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
const SSE_RECONNECT_MS = 2_000;
const HISTORY_POLL_MS = 15_000;

function cardDedupeKey(card: DiscoveryCard): string {
  // SSE cards use in-memory ids; history uses DB ids — dedupe across sources.
  return `${card.signalType}|${card.subject}|${card.createdAt}|${card.headline}`;
}

function mergeDiscoveries(prev: DiscoveryCard[], incoming: DiscoveryCard[]): {
  next: DiscoveryCard[];
  added: number;
} {
  if (incoming.length === 0) return { next: prev, added: 0 };
  const seen = new Set(prev.map(cardDedupeKey));
  const fresh: DiscoveryCard[] = [];
  for (const card of incoming) {
    const key = cardDedupeKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(card);
  }
  if (fresh.length === 0) return { next: prev, added: 0 };
  const next = [...fresh, ...prev].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return {
    next: next.length > MAX_FEED_SIZE ? next.slice(0, MAX_FEED_SIZE) : next,
    added: fresh.length,
  };
}

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
  const streamStatusRef = useRef(streamStatus);
  streamStatusRef.current = streamStatus;

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

  // ── SSE connection with hard reconnect (Render can CLOSE the stream) ──

  useEffect(() => {
    if (mode === "off") {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setStreamStatus("offline");
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      eventSourceRef.current?.close();

      const es = new EventSource("/api/scanner/stream");
      eventSourceRef.current = es;
      setStreamStatus("reconnecting");

      es.onopen = () => {
        if (!cancelled) setStreamStatus("live");
      };

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
          if (!card?.signalType || !card?.subject || !card?.createdAt) return;

          setDiscoveries((prev) => {
            const { next, added } = mergeDiscoveries(prev, [card]);
            if (added > 0 && !panelOpenRef.current) {
              setUnreadCount((c) => c + added);
            }
            return next;
          });
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        if (cancelled) return;
        // Browser auto-reconnects while CONNECTING; once CLOSED we must open a new ES.
        if (es.readyState === EventSource.CLOSED) {
          setStreamStatus("offline");
          eventSourceRef.current = null;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, SSE_RECONNECT_MS);
        } else {
          setStreamStatus("reconnecting");
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setStreamStatus("offline");
    };
  }, [mode]);

  // ── History seed + poll fallback (keeps feed alive if SSE stalls) ───────

  useEffect(() => {
    if (mode === "off") return;

    let cancelled = false;

    const pullHistory = (bumpUnread: boolean) => {
      fetch("/api/scanner/history?limit=100")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data.discoveries?.length) return;
          setDiscoveries((prev) => {
            const { next, added } = mergeDiscoveries(prev, data.discoveries);
            if (bumpUnread && added > 0 && !panelOpenRef.current) {
              setUnreadCount((c) => c + added);
            }
            return next;
          });
        })
        .catch(() => {});
    };

    pullHistory(false);
    const handle = setInterval(() => {
      // Always poll — cheap safety net when Render drops SSE without a clean CLOSE.
      pullHistory(streamStatusRef.current !== "live");
    }, HISTORY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [mode]);

  // ── Periodic status fetch ─────────────────────────────────────────────

  useEffect(() => {
    if (mode === "off") return;

    const fetchStatus = () => {
      fetch("/api/scanner/status")
        .then((r) => r.json())
        .then((s: ScannerStatus) => setStatus(s))
        .catch(() => {});
    };

    fetchStatus();
    const handle = setInterval(fetchStatus, 15_000);
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
