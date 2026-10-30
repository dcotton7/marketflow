import type { WatchlistColumnEntry, WatchlistColumnId } from "@/lib/watchlist-column-profile";

/**
 * Position columns for the Anima Lab's Full watchlist panel: side (long/short), P/L today and P/L open, signed the
 * way the position makes money (a short gains when the price falls). Side is MarketFlow's own `direction` on the
 * row; Anima also keeps shorts it was told about in chat that may not be written here yet.
 */
export interface PositionPl {
  side: "long" | "short";
  plToday: number | null;
  plOpen: number | null;
  plOpenPct: number | null;
}

export function positionPl(row: {
  direction?: string | null;
  shares?: number | null;
  entry?: number | null;
  price?: number | null;
  change?: number | null;
}): PositionPl {
  const side = String(row.direction ?? "").toLowerCase() === "short" ? "short" : "long";
  const sign = side === "short" ? -1 : 1;
  const shares = Number(row.shares) || 0;
  const price = Number(row.price) || 0;
  const entry = Number(row.entry) || 0;
  const live = shares > 0 && price > 0;
  return {
    side,
    plToday: live && row.change != null && Number.isFinite(Number(row.change)) ? sign * shares * Number(row.change) : null,
    plOpen: live && entry > 0 ? sign * shares * (price - entry) : null,
    plOpenPct: price > 0 && entry > 0 ? (sign * (price - entry) / entry) * 100 : null,
  };
}

/** Which columns go first as the panel narrows (first in this list = first hidden). Ticker and the remove button stay. */
export const HIDE_ORDER: WatchlistColumnId[] = [
  "company", "theme", "entryDate", "ema620", "vwapPct", "change", "entryPct", "stopPct", "entry", "side", "plOpen",
  "stop", "shares", "plToday", "changePct",
];

/**
 * The columns that fit `width` px: lower-priority ones are left out (never Ticker or the remove button) until the
 * rest fit; the user's own columns, order and widths otherwise. `hidden` names what was left out.
 */
export function fitColumns(columns: WatchlistColumnEntry[], width: number): {
  shown: WatchlistColumnEntry[];
  hidden: WatchlistColumnId[];
} {
  if (!(width > 0)) return { shown: columns, hidden: [] };
  const hidden = new Set<WatchlistColumnId>();
  const total = () => columns.reduce((sum, c) => sum + (hidden.has(c.id) ? 0 : c.width), 0);
  const order = [
    ...HIDE_ORDER.filter((id) => columns.some((c) => c.id === id)),
    ...columns.map((c) => c.id).filter((id) => !HIDE_ORDER.includes(id) && id !== "symbol" && id !== "actions"),
  ];
  for (const id of order) {
    if (total() <= width) break;
    hidden.add(id);
  }
  return { shown: columns.filter((c) => !hidden.has(c.id)), hidden: Array.from(hidden) };
}
