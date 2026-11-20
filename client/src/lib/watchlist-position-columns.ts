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
  // A negative share count (as thinkorswim shows a short) is a short of that many shares, whatever the side says.
  const rawShares = Number(row.shares) || 0;
  const side = String(row.direction ?? "").toLowerCase() === "short" || rawShares < 0 ? "short" : "long";
  const sign = side === "short" ? -1 : 1;
  const shares = Math.abs(rawShares);
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

/** What a P/L cell shows: dollars when shares are known, else the move per share, else what is missing (never blank). */
export type PlCell =
  | { state: "full"; dollars: number; pct: number | null }
  | { state: "perShare"; perShare: number; pct: number | null }
  | { state: "missing"; why: "No price" | "No entry" };

export interface PlRow {
  side?: "long" | "short";
  shares?: number | null;
  entry?: number | null;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  plToday?: number | null;
  plOpen?: number | null;
  plOpenPct?: number | null;
}

/** The three display states of the P/L Today and P/L Open cells. */
export function plCell(row: PlRow, col: "plToday" | "plOpen"): PlCell {
  const sign = row.side === "short" ? -1 : 1;
  const dollars = col === "plToday" ? row.plToday : row.plOpen;
  if (dollars != null) return { state: "full", dollars, pct: col === "plOpen" ? row.plOpenPct ?? null : null };
  const price = Number(row.price) || 0;
  if (!(price > 0)) return { state: "missing", why: "No price" };
  if (col === "plOpen") {
    if (!(Number(row.entry) > 0)) return { state: "missing", why: "No entry" };
    return { state: "perShare", perShare: sign * (price - Number(row.entry)), pct: row.plOpenPct ?? null };
  }
  const change = Number(row.change);
  if (!Number.isFinite(change)) return { state: "missing", why: "No price" };
  const cp = Number(row.changePercent);
  return { state: "perShare", perShare: sign * change, pct: Number.isFinite(cp) ? sign * cp : null };
}

export interface PlTotal {
  dollars: number;
  pct: number | null;
  /** Rows that had dollars (shares known) out of all rows. */
  counted: number;
  rows: number;
}

/** The list's total P/L: only rows with a dollar figure add in; pct is over the cost of those rows. */
export function plTotals(rows: PlRow[], col: "plToday" | "plOpen"): PlTotal {
  let dollars = 0;
  let cost = 0;
  let counted = 0;
  for (const r of rows) {
    const d = col === "plToday" ? r.plToday : r.plOpen;
    if (d == null) continue;
    counted++;
    dollars += d;
    cost += Math.abs(Number(r.shares) || 0) * (Number(r.entry) || 0);
  }
  // A percent only for P/L Open (over the cost of the counted rows); today's has no cost base.
  const pct = col === "plOpen" && counted > 0 && cost > 0 ? (dollars / cost) * 100 : null;
  return { dollars, pct, counted, rows: rows.length };
}

/**
 * % Entry and % Stop, positive (green) when the position is doing well: a long's price above its entry and stop, a
 * short's price below its entry and stop (a short's stop sits above the price, so room to the stop is stop - price).
 */
export function entryStopPct(row: {
  direction?: string | null;
  entry?: number | null;
  stop?: number | null;
  price?: number | null;
}): { entryPct: number | null; stopPct: number | null } {
  const sign = String(row.direction ?? "").toLowerCase() === "short" ? -1 : 1;
  const price = Number(row.price) || 0;
  const entry = Number(row.entry) || 0;
  const stop = Number(row.stop) || 0;
  return {
    entryPct: entry > 0 && price > 0 ? (sign * (price - entry) / entry) * 100 : null,
    stopPct: stop > 0 && price > 0 ? (sign * (price - stop) / stop) * 100 : null,
  };
}

/** Columns the panel must show by default, and the one-time catch-up that adds them to a config saved before they existed. */
export const POSITION_COLUMN_IDS: WatchlistColumnId[] = ["side", "plToday", "plOpen"];

export function addMissingPositionColumns(
  columns: WatchlistColumnEntry[],
  defaultWidth: (id: WatchlistColumnId) => number,
): WatchlistColumnEntry[] {
  const missing = POSITION_COLUMN_IDS.filter((id) => !columns.some((c) => c.id === id));
  if (missing.length === 0) return columns;
  const actions = columns.find((c) => c.id === "actions");
  const rest = columns.filter((c) => c.id !== "actions");
  const at = rest.findIndex((c) => c.id === "changePct");
  const add = missing.map((id) => ({ id, width: defaultWidth(id) }));
  // Side right after % Chg (as in the default layout); the P/L columns before the remove button.
  const side = add.filter((c) => c.id === "side");
  const pl = add.filter((c) => c.id !== "side");
  const withSide = at >= 0 ? [...rest.slice(0, at + 1), ...side, ...rest.slice(at + 1)] : [...rest, ...side];
  return [...withSide, ...pl, ...(actions ? [actions] : [])];
}

/** Which columns go first as the panel narrows (first in this list = first hidden). Ticker and the remove button stay. */
export const HIDE_ORDER: WatchlistColumnId[] = [
  // P/L Open is what he opened the panel for: it is the last to go, with Side (every P/L sign reads by it) near it.
  "company", "theme", "entryDate", "ema620", "vwapPct", "change", "entryPct", "stopPct", "entry",
  "stop", "shares", "changePct", "plToday", "side", "plOpen",
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
