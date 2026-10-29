/**
 * Global ToS sync — when enabled, ticker clicks / symbol changes drive Thinkorswim.
 * Toggle is shared across Flow, Charts, and pop-out windows via localStorage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchTosStatus,
  isEmbeddedInAnima,
  isWindowsClient,
  pokeFidelityLead,
  startTosLinkHelper,
  startTosStatusPolling,
  tosErrorMessage,
  tosNavigate as tosNavigateApi,
} from "@/lib/tos-bridge-client";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "tosSyncEnabled";
const LEGACY_SESSION_KEY = "tosSyncEnabled";

interface TosStatus {
  available: boolean;
  calibrated: boolean;
  position: { x: number; y: number } | null;
  calibratedAt: string | null;
}

interface TosSyncContextType {
  tosSyncEnabled: boolean;
  setTosSyncEnabled: (enabled: boolean) => void;
  toggleTosSync: () => void;
  tosNavigate: (symbol: string) => Promise<void>;
  tosAvailable: boolean;
  tosCalibrated: boolean;
  refreshStatus: () => Promise<void>;
  /** In Anima's Lab: Anima drives Thinkorswim, so sync stays off and ToSLink is never called. */
  animaHosted: boolean;
}

const TosSyncContext = createContext<TosSyncContextType | undefined>(undefined);

function readStoredToggle(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true" || stored === "false") return stored === "true";
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy === "true") {
      localStorage.setItem(STORAGE_KEY, "true");
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function writeStoredToggle(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore */
  }
}


/** Latest-wins queue so arrowing through charts does not type every ticker into ToS. */
const SAME_SYMBOL_COOLDOWN_MS = 4000;
const AUTOSTART_EVERY_MS = 60_000;
const AUTOSTART_WAIT_MS = 12_000;
let lastAutostart = 0;

/** The helper is down: ask Windows to start it (needs the click's user gesture), then wait for it to answer. */
async function autostartHelper(): Promise<boolean> {
  const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
  if (!isWindowsClient() || active === false || Date.now() - lastAutostart < AUTOSTART_EVERY_MS) return false;
  lastAutostart = Date.now();
  startTosLinkHelper();
  const until = Date.now() + AUTOSTART_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => window.setTimeout(r, 1000));
    const s = await fetchTosStatus();
    if (s.available && s.source === "agent") return true;
  }
  return false;
}
const navigateQueue: {
  inflight: boolean;
  inflightSymbol: string | null;
  pending: string | null;
  lastSymbol: string;
  lastAt: number;
} = {
  inflight: false,
  inflightSymbol: null,
  pending: null,
  lastSymbol: "",
  lastAt: 0,
};

const ANIMA_HOSTED_VALUE: TosSyncContextType = {
  tosSyncEnabled: false,
  setTosSyncEnabled: () => {},
  toggleTosSync: () => {},
  tosNavigate: async () => {},
  tosAvailable: false,
  tosCalibrated: false,
  refreshStatus: async () => {},
  animaHosted: true,
};

export function TosSyncProvider({ children }: { children: ReactNode }) {
  if (isEmbeddedInAnima()) {
    return <TosSyncContext.Provider value={ANIMA_HOSTED_VALUE}>{children}</TosSyncContext.Provider>;
  }
  return <LocalTosSyncProvider>{children}</LocalTosSyncProvider>;
}

function LocalTosSyncProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [tosSyncEnabled, setTosSyncEnabledState] = useState(readStoredToggle);
  const [status, setStatus] = useState<TosStatus>({
    available: false,
    calibrated: false,
    position: null,
    calibratedAt: null,
  });

  const refreshStatus = useCallback(async () => {
    // KILL SWITCH 2026-10-06: do not wake Fidelity Lead or follow fidelitySymbol.
    // pokeFidelityLead is itself a no-op; ToS status / MarketFlow→ToS navigate stay live.
    pokeFidelityLead();
    const s = await fetchTosStatus();
    setStatus(s);
  }, []);

  useEffect(() => startTosStatusPolling(() => { void refreshStatus(); }), [refreshStatus]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      setTosSyncEnabledState(e.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTosSyncEnabled = useCallback((enabled: boolean) => {
    setTosSyncEnabledState(enabled);
    writeStoredToggle(enabled);
  }, []);

  const toggleTosSync = useCallback(() => {
    setTosSyncEnabled(!tosSyncEnabled);
  }, [setTosSyncEnabled, tosSyncEnabled]);

  const pumpNavigate = useCallback(async () => {
    if (navigateQueue.inflight) return;
    navigateQueue.inflight = true;
    try {
      while (navigateQueue.pending) {
        const next = navigateQueue.pending;
        navigateQueue.pending = null;
        navigateQueue.inflightSymbol = next;
        try {
          try {
            await tosNavigateApi(next);
          } catch (first) {
            if ((await fetchTosStatus()).available || !(await autostartHelper())) throw first;
            await tosNavigateApi(next);
          }
        } catch (err) {
          console.warn("[ToSLink]", err);
          toastRef.current({
            title: "ToSLink did not switch",
            description: tosErrorMessage(err),
            variant: "destructive",
          });
          break;
        } finally {
          navigateQueue.inflightSymbol = null;
        }
      }
    } finally {
      navigateQueue.inflight = false;
      if (navigateQueue.pending) {
        void pumpNavigate();
      }
    }
  }, []);

  const tosNavigate = useCallback(async (symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    const now = Date.now();
    if (clean === navigateQueue.lastSymbol && now - navigateQueue.lastAt < SAME_SYMBOL_COOLDOWN_MS) {
      return;
    }
    if (navigateQueue.pending === clean) return;
    if (navigateQueue.inflightSymbol === clean) return;
    navigateQueue.lastSymbol = clean;
    navigateQueue.lastAt = now;
    navigateQueue.pending = clean;
    await pumpNavigate();
  }, [pumpNavigate]);

  const value = useMemo(
    () => ({
      tosSyncEnabled,
      setTosSyncEnabled,
      toggleTosSync,
      tosNavigate,
      tosAvailable: status.available,
      tosCalibrated: status.calibrated,
      refreshStatus,
      animaHosted: false,
    }),
    [
      tosSyncEnabled,
      setTosSyncEnabled,
      toggleTosSync,
      tosNavigate,
      status.available,
      status.calibrated,
      refreshStatus,
    ]
  );

  return (
    <TosSyncContext.Provider value={value}>{children}</TosSyncContext.Provider>
  );
}

export function useTosSync() {
  const ctx = useContext(TosSyncContext);
  if (!ctx) {
    throw new Error("useTosSync must be used within a TosSyncProvider");
  }
  return ctx;
}

/** Safe variant — returns null outside provider (optional surfaces). */
export function useTosSyncSafe() {
  return useContext(TosSyncContext) ?? null;
}
