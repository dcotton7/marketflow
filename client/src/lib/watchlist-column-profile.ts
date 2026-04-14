/** Column ids for configurable watchlist tables (modal + Start Here portal). */

export type WatchlistColumnId =
  | "chart"
  | "symbol"
  | "company"
  | "theme"
  | "change"
  | "changePct"
  | "entry"
  | "entryPct"
  | "stop"
  | "stopPct"
  | "actions";

export const WATCHLIST_COLUMN_PROFILE_VERSION = 2 as const;

export interface WatchlistColumnEntry {
  id: WatchlistColumnId;
  width: number;
}

export interface WatchlistColumnProfileFile {
  /** v1: one-time migration inserts Theme after Company when missing. v2: layout is authoritative. */
  v: 1 | typeof WATCHLIST_COLUMN_PROFILE_VERSION;
  columns: WatchlistColumnEntry[];
}

export type WatchlistTableVariant = "modal" | "portal";

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export const WATCHLIST_COLUMN_META: Record<
  WatchlistColumnId,
  { label: string; defaultWidth: number; minWidth: number; portalOnly?: boolean }
> = {
  chart: { label: "Chart", defaultWidth: 40, minWidth: 32, portalOnly: true },
  symbol: { label: "Ticker", defaultWidth: 88, minWidth: 40 },
  company: { label: "Company", defaultWidth: 184, minWidth: 44 },
  theme: { label: "Theme", defaultWidth: 160, minWidth: 44 },
  change: { label: "$ Chg", defaultWidth: 80, minWidth: 40 },
  changePct: { label: "% Chg", defaultWidth: 80, minWidth: 40 },
  entry: { label: "Entry", defaultWidth: 112, minWidth: 44 },
  entryPct: { label: "% Entry", defaultWidth: 96, minWidth: 40 },
  stop: { label: "Stop", defaultWidth: 112, minWidth: 44 },
  stopPct: { label: "% Stop", defaultWidth: 96, minWidth: 40 },
  actions: { label: "", defaultWidth: 48, minWidth: 36 },
};

/** Cannot remove these ids from a profile. */
export const WATCHLIST_REQUIRED_COLUMN_IDS: WatchlistColumnId[] = ["symbol", "actions"];

/** Interpret legacy persisted `number[]` widths only (before Theme column existed). */
const LEGACY_MODAL_COLUMN_ORDER: WatchlistColumnId[] = [
  "symbol",
  "company",
  "change",
  "changePct",
  "entry",
  "entryPct",
  "stop",
  "stopPct",
  "actions",
];

const LEGACY_PORTAL_COLUMN_ORDER: WatchlistColumnId[] = [
  "chart",
  "symbol",
  "company",
  "change",
  "changePct",
  "entry",
  "entryPct",
  "stop",
  "stopPct",
  "actions",
];

const MODAL_DEFAULT_ORDER: WatchlistColumnId[] = [
  "symbol",
  "company",
  "theme",
  "change",
  "changePct",
  "entry",
  "entryPct",
  "stop",
  "stopPct",
  "actions",
];

const PORTAL_DEFAULT_ORDER: WatchlistColumnId[] = [
  "chart",
  "symbol",
  "company",
  "theme",
  "change",
  "changePct",
  "entry",
  "entryPct",
  "stop",
  "stopPct",
  "actions",
];

/** Compact layout (e.g. index-style): fewer columns; not auto-applied on first load. */
const MODAL_SIMPLE_ORDER: WatchlistColumnId[] = [
  "symbol",
  "company",
  "change",
  "changePct",
  "actions",
];

const PORTAL_SIMPLE_ORDER: WatchlistColumnId[] = [
  "chart",
  "symbol",
  "company",
  "change",
  "changePct",
  "actions",
];

export function defaultColumnOrder(variant: WatchlistTableVariant): WatchlistColumnId[] {
  return variant === "portal" ? [...PORTAL_DEFAULT_ORDER] : [...MODAL_DEFAULT_ORDER];
}

export function simpleColumnOrder(variant: WatchlistTableVariant): WatchlistColumnId[] {
  return variant === "portal" ? [...PORTAL_SIMPLE_ORDER] : [...MODAL_SIMPLE_ORDER];
}

export function defaultProfile(variant: WatchlistTableVariant): WatchlistColumnEntry[] {
  return defaultColumnOrder(variant).map((id) => ({
    id,
    width: WATCHLIST_COLUMN_META[id].defaultWidth,
  }));
}

export function simpleDefaultProfile(variant: WatchlistTableVariant): WatchlistColumnEntry[] {
  return simpleColumnOrder(variant).map((id) => ({
    id,
    width: WATCHLIST_COLUMN_META[id].defaultWidth,
  }));
}

export function allowedColumnIds(variant: WatchlistTableVariant): WatchlistColumnId[] {
  return (Object.keys(WATCHLIST_COLUMN_META) as WatchlistColumnId[]).filter(
    (id) => variant === "portal" || !WATCHLIST_COLUMN_META[id].portalOnly
  );
}

export function isColumnAllowed(id: WatchlistColumnId, variant: WatchlistTableVariant): boolean {
  if (variant === "modal" && WATCHLIST_COLUMN_META[id].portalOnly) return false;
  return id in WATCHLIST_COLUMN_META;
}

/** Used when loading v1 profiles or legacy width arrays (not on every normalize — user may hide Theme). */
function insertThemeAfterCompanyIfMissing(columns: WatchlistColumnEntry[]): WatchlistColumnEntry[] {
  if (columns.some((c) => c.id === "theme")) return columns;
  const companyIdx = columns.findIndex((c) => c.id === "company");
  if (companyIdx < 0) return columns;
  const next = [...columns];
  next.splice(companyIdx + 1, 0, {
    id: "theme",
    width: WATCHLIST_COLUMN_META.theme.defaultWidth,
  });
  return next;
}

export function normalizeWatchlistColumnEntries(
  columns: WatchlistColumnEntry[],
  variant: WatchlistTableVariant
): WatchlistColumnEntry[] {
  const allowed = new Set(allowedColumnIds(variant));
  const seen = new Set<WatchlistColumnId>();
  const out: WatchlistColumnEntry[] = [];
  for (const c of columns) {
    if (!allowed.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    const m = WATCHLIST_COLUMN_META[c.id];
    out.push({
      id: c.id,
      width: clamp(
        Number.isFinite(c.width) ? c.width : m.defaultWidth,
        m.minWidth,
        560
      ),
    });
  }
  for (const req of WATCHLIST_REQUIRED_COLUMN_IDS) {
    if (!variantAllows(req, variant)) continue;
    if (!seen.has(req)) {
      seen.add(req);
      out.push({
        id: req,
        width: WATCHLIST_COLUMN_META[req].defaultWidth,
      });
    }
  }
  const order = defaultColumnOrder(variant);
  out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return out;
}

function variantAllows(id: WatchlistColumnId, variant: WatchlistTableVariant): boolean {
  return variant === "portal" || !WATCHLIST_COLUMN_META[id].portalOnly;
}

/** Migrate legacy JSON: number[] widths in default column order. */
function migrateLegacyWidthArray(
  arr: number[],
  variant: WatchlistTableVariant
): WatchlistColumnEntry[] {
  const order = variant === "portal" ? LEGACY_PORTAL_COLUMN_ORDER : LEGACY_MODAL_COLUMN_ORDER;
  const cols: WatchlistColumnEntry[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const m = WATCHLIST_COLUMN_META[id];
    const w = arr[i];
    cols.push({
      id,
      width: clamp(
        typeof w === "number" && Number.isFinite(w) ? w : m.defaultWidth,
        m.minWidth,
        560
      ),
    });
  }
  return insertThemeAfterCompanyIfMissing(normalizeWatchlistColumnEntries(cols, variant));
}

export function parseWatchlistColumnProfile(
  raw: string | null,
  variant: WatchlistTableVariant
): WatchlistColumnEntry[] {
  if (!raw) return defaultProfile(variant);
  try {
    const p = JSON.parse(raw) as unknown;
    if (Array.isArray(p)) {
      const nums = p.filter((x) => typeof x === "number" || (typeof x === "string" && x !== ""));
      const asNumbers = nums.map((x) => Number(x));
      if (asNumbers.length > 0 && asNumbers.every((n) => Number.isFinite(n))) {
        return migrateLegacyWidthArray(asNumbers, variant);
      }
      return defaultProfile(variant);
    }
    if (p && typeof p === "object") {
      const ver = (p as { v?: unknown }).v;
      if (ver !== 1 && ver !== 2) return defaultProfile(variant);
      const cols = (p as WatchlistColumnProfileFile).columns;
      if (!Array.isArray(cols)) return defaultProfile(variant);
      const entries: WatchlistColumnEntry[] = cols
        .filter(
          (c): c is WatchlistColumnEntry =>
            !!c &&
            typeof c === "object" &&
            typeof (c as WatchlistColumnEntry).id === "string"
        )
        .map((c) => ({
          id: c.id as WatchlistColumnId,
          width: typeof c.width === "number" ? c.width : WATCHLIST_COLUMN_META[c.id as WatchlistColumnId]?.defaultWidth ?? 80,
        }));
      const normalized = normalizeWatchlistColumnEntries(entries, variant);
      return ver === 1 ? insertThemeAfterCompanyIfMissing(normalized) : normalized;
    }
  } catch {
    /* fall through */
  }
  return defaultProfile(variant);
}

export function serializeWatchlistColumnProfile(columns: WatchlistColumnEntry[]): string {
  const file: WatchlistColumnProfileFile = {
    v: WATCHLIST_COLUMN_PROFILE_VERSION,
    columns,
  };
  return JSON.stringify(file);
}

export function profileIds(columns: WatchlistColumnEntry[]): WatchlistColumnId[] {
  return columns.map((c) => c.id);
}
