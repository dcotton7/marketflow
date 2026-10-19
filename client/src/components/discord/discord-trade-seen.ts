import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

/** Trade calls the Discord analysis reports (subset of fields used for "new trade" tracking). */
export interface SeenTradeCall {
  id: string;
  author: string;
  text: string;
  ts: number;
  action?: string | null;
}

export const DEFAULT_TRADERS = ["Nick Drendel", "RealSimpleAriel"];

/** Entries live in the "New trades" box (today); exits in "Trims & closes" (last 3 trading days). */
export const ENTRY_ACTIONS = new Set(["buy", "add", "short"]);
export const EXIT_ACTIONS = new Set(["trim", "sell", "stop", "cover"]);

const STORE_KEY = "mf-discord-trades-seen-v2";
const CHANGE_EVENT = "mf-discord-trades-seen-change";
const POLL_MS = 5000;
const KEEP_MS = 7 * 24 * 60 * 60_000;

/**
 * Identity of a trade post that survives a pop-up copy being replaced by the channel copy (new id)
 * and a server restart (new seq).
 */
export const tradeKey = (c: SeenTradeCall) => `${c.author.toLowerCase()}|${c.text.toLowerCase().replace(/\s+/g, " ").trim()}`;

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

const getSnapshot = () => localStorage.getItem(STORE_KEY) ?? "";

/** key → when it was marked seen (ms). */
function parseSeen(raw: string): Record<string, number> {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(v ?? {})) if (typeof t === "number") out[k] = t;
    return out;
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, number>) {
  const cutoff = Date.now() - KEEP_MS;
  const kept = Object.fromEntries(Object.entries(seen).filter(([, t]) => t >= cutoff));
  localStorage.setItem(STORE_KEY, JSON.stringify(kept));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Nick / Ari trade calls and which of them have not been looked at yet, split into today's entries and
 * the last 3 trading days of exits. Shared across the page (one poll, same query key).
 */
export function useUnseenTradeCalls(enabled: boolean, traders: string[] = DEFAULT_TRADERS) {
  const traderKey = traders.join(",");
  const { data } = useQuery<SeenTradeCall[]>({
    queryKey: ["/api/discord-stream/analysis", "trade-calls", traderKey],
    queryFn: async () => {
      const res = await fetch(`/api/discord-stream/analysis?window=5&traders=${encodeURIComponent(traderKey)}`, { credentials: "include" });
      if (!res.ok) return [];
      const body = (await res.json()) as { tradeCalls?: SeenTradeCall[] };
      return body.tradeCalls ?? [];
    },
    enabled,
    refetchInterval: POLL_MS,
  });

  const raw = useSyncExternalStore(subscribe, getSnapshot);
  const seen = useMemo(() => parseSeen(raw), [raw]);

  const { entries, exits } = useMemo(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    const all = data ?? [];
    return {
      entries: all.filter((c) => c.ts >= today && ENTRY_ACTIONS.has(c.action ?? "")),
      exits: all.filter((c) => EXIT_ACTIONS.has(c.action ?? "")),
    };
  }, [data]);

  const unseenEntries = useMemo(() => entries.filter((c) => !(tradeKey(c) in seen)), [entries, seen]);
  const unseenExits = useMemo(() => exits.filter((c) => !(tradeKey(c) in seen)), [exits, seen]);
  const unseen = useMemo(() => [...unseenEntries, ...unseenExits], [unseenEntries, unseenExits]);

  const markSeen = useCallback(
    (which?: SeenTradeCall[]) => {
      const next = parseSeen(getSnapshot());
      const now = Date.now();
      for (const c of which ?? [...entries, ...exits]) next[tradeKey(c)] = now;
      writeSeen(next);
    },
    [entries, exits],
  );

  const isSeen = useCallback((c: SeenTradeCall) => tradeKey(c) in seen, [seen]);

  return { entries, exits, unseen, unseenEntries, unseenExits, markSeen, isSeen };
}
