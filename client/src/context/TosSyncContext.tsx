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
import { fetchTosStatus, tosErrorMessage, tosNavigate as tosNavigateApi } from "@/lib/tos-bridge-client";
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
const navigateQueue: { inflight: boolean; pending: string | null } = {
  inflight: false,
  pending: null,
};

export function TosSyncProvider({ children }: { children: ReactNode }) {
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
    const s = await fetchTosStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => { void refreshStatus(); }, 5000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

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
        try {
          await tosNavigateApi(next);
        } catch (err) {
          console.warn("[ToS sync]", err);
          toastRef.current({
            title: "ToS did not switch",
            description: tosErrorMessage(err),
            variant: "destructive",
          });
          break;
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
