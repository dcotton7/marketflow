import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Weight steps the reader can give a person in the room. */
export const WEIGHT_UP = 1.25;
export const WEIGHT_DOWN = 0.75;

const STORE_KEY = "mf-discord-author-weights";
const CHANGE_EVENT = "mf-discord-author-weights-change";

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

const getSnapshot = () => localStorage.getItem(STORE_KEY) ?? "{}";

function parse(raw: string): Record<string, number> {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v ?? {})) if (typeof n === "number" && n !== 1) out[k] = n;
    return out;
  } catch {
    return {};
  }
}

/** Per-person weights (display name → 1.25 / 0.75), saved on this browser. */
export function useAuthorWeights() {
  const raw = useSyncExternalStore(subscribe, getSnapshot);
  const weights = useMemo(() => parse(raw), [raw]);

  const setWeight = useCallback((name: string, weight: number | null) => {
    const next = parse(getSnapshot());
    if (weight == null || weight === 1) delete next[name];
    else next[name] = weight;
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const weightOf = useCallback((name: string) => weights[name] ?? 1, [weights]);

  return { weights, setWeight, weightOf, raw };
}
