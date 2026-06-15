import type { ClusterId, ThemeMetrics } from "@/hooks/useMarketCondition";
import type { StartHereInterval } from "@/components/MiniChart";
import type { ThemeId, ThemeRow } from "@/data/mockThemeData";

export {
  getLeadingDirectEtfSymbol,
  getThemeChartSymbolCandidates,
  SUBTHEME_PRIMARY_CHART_ETF,
} from "@/lib/theme-chart-symbols";

/** Live current data, or ISO timestamp of a stored 15-minute intraday snapshot. */
export type LiveThemeChartsSnapshotKey = "live" | (string & {});

/** Theme box stats (rank, scorecard, breakdown) refresh cadence — matches server 15m snapshot saves. */
export const LIVE_THEME_BOX_REFETCH_MS = 15 * 60 * 1000;

/** Buffer after each 15m ET slot so the server poll can persist the snapshot before we refetch. */
const THEME_BOX_SAVE_BUFFER_MS = 60_000;

/** After theme-box data changes, warn this long before reordering top/bottom rows. */
export const LIVE_THEME_REORDER_WARNING_SEC = 30;

/** CSS transition duration when rows move to new order. */
export const LIVE_THEME_REORDER_TRANSITION_MS = 700;

/**
 * Ms until the next theme-box refetch, aligned to ET 15-minute slots (+ save buffer).
 * Charts use the mini-chart intraday refetch (~60s) separately.
 */
export function msUntilNextThemeBoxRefresh(now = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const minute = part("minute");
  const second = part("second");
  const slotMinute = Math.floor(minute / 15) * 15;
  const msIntoSlot = (minute - slotMinute) * 60_000 + second * 1000 + now.getMilliseconds();
  const msUntilNextSlot = 15 * 60_000 - msIntoSlot;
  return Math.max(60_000, msUntilNextSlot + THEME_BOX_SAVE_BUFFER_MS);
}

export const LIVE_THEME_CHARTS_MAX_ROWS = 8;

export const LIVE_THEME_CHART_INTERVAL_OPTIONS: StartHereInterval[] = ["5m", "15m", "30m", "1d"];
export const DEFAULT_LIVE_THEME_CHARTS_CHART_INTERVAL: StartHereInterval = "30m";

/** Last mini-chart interval chosen in Live Theme Charts or Flow ThemeChart review. */
export const THEME_CHARTS_LAST_INTERVAL_STORAGE_KEY = "sps:theme-charts-last-interval";

export function readPersistedThemeChartsInterval(): StartHereInterval | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(THEME_CHARTS_LAST_INTERVAL_STORAGE_KEY);
    if (!raw) return null;
    return normalizeLiveThemeChartsChartInterval(raw);
  } catch {
    return null;
  }
}

export function writePersistedThemeChartsInterval(interval: StartHereInterval): void {
  try {
    localStorage.setItem(
      THEME_CHARTS_LAST_INTERVAL_STORAGE_KEY,
      normalizeLiveThemeChartsChartInterval(interval)
    );
  } catch {
    /* ignore quota / private mode */
  }
}

/** Default widget config; chart interval restores from localStorage when set. */
export function defaultLiveThemeChartsConfig(): LiveThemeChartsConfig {
  const persisted = readPersistedThemeChartsInterval();
  return {
    ...DEFAULT_LIVE_THEME_CHARTS_CONFIG,
    chartInterval: persisted ?? DEFAULT_LIVE_THEME_CHARTS_CHART_INTERVAL,
  };
}

/** Approximate pixel height of one theme row (mini chart + scorecard panel). */
export const THEME_CHART_ROW_PX = 196;
/** Widget chrome, column headers, subtitle, and padding above the scroll area. */
export const THEME_CHARTS_WIDGET_CHROME_PX = 128;

export function normalizeLiveThemeChartsChartInterval(raw: unknown): StartHereInterval {
  const s = String(raw ?? DEFAULT_LIVE_THEME_CHARTS_CHART_INTERVAL);
  if (s === "5m" || s === "15m" || s === "30m" || s === "1d") return s;
  return DEFAULT_LIVE_THEME_CHARTS_CHART_INTERVAL;
}

export function isLiveThemeChartsSnapshotKey(value: unknown): value is LiveThemeChartsSnapshotKey {
  return value === "live" || (typeof value === "string" && value.includes("T"));
}

export function formatAdrs50smaLine(adrsFrom50: number | null | undefined): string {
  if (adrsFrom50 == null || !Number.isFinite(adrsFrom50)) return "#ADRS-50sma: --";
  const abs = Math.abs(adrsFrom50);
  const absStr = abs.toFixed(1);
  if (adrsFrom50 >= 0) return `#ADRS-50sma: ${absStr}#`;
  return `#ADRS-50sma: ${absStr} (${adrsFrom50.toFixed(1)})`;
}

/** Mini-chart lower-right: distance from 50d SMA in ATR(14) multiples. */
export function formatAtrx50maLine(atrMultFrom50: number | null | undefined): string {
  if (atrMultFrom50 == null || !Number.isFinite(atrMultFrom50)) return "ATRx50ma: --";
  const abs = Math.abs(atrMultFrom50).toFixed(1);
  if (atrMultFrom50 >= 0) return `ATRx50ma: ${abs} ATRs above 50d`;
  return `ATRx50ma: ${abs} ATRs below 50d`;
}

export function snapshotKeyLabel(
  key: LiveThemeChartsSnapshotKey,
  slotLabels?: Map<string, string>,
  comparisonTime?: string | null
): string {
  if (key === "live") {
    if (comparisonTime) {
      const vs = new Date(comparisonTime).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `Live · 15m · vs ${vs}`;
    }
    return "Live · 15m refresh";
  }
  return slotLabels?.get(key) ?? new Date(key).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function maxThemeChartRowsInConfig(config: LiveThemeChartsConfig): number {
  let maxRows = 0;
  if (config.top.enabled) maxRows = Math.max(maxRows, config.top.count);
  if (config.bottom.enabled) maxRows = Math.max(maxRows, config.bottom.count);
  if (config.specific.enabled) maxRows = Math.max(maxRows, config.specific.themeIds.length);
  return maxRows;
}

/** Content height in px needed to show all rows without inner-column scroll. */
export function estimateThemeChartsContentHeightPx(config: LiveThemeChartsConfig): number {
  const maxRows = maxThemeChartRowsInConfig(config);
  if (maxRows <= 0) return 360;
  const rowGapPx = 8;
  return (
    THEME_CHARTS_WIDGET_CHROME_PX +
    maxRows * THEME_CHART_ROW_PX +
    Math.max(0, maxRows - 1) * rowGapPx
  );
}

export type LiveThemeChartsColumnConfig = {
  enabled: boolean;
  /** "live" for current; otherwise ISO time of a stored 15m snapshot baseline. */
  snapshotKey: LiveThemeChartsSnapshotKey;
  refetchIntervalMs?: number;
};

export type LiveThemeChartsConfig = {
  /** Mini chart bar interval for all rows in this widget. */
  chartInterval: StartHereInterval;
  top: LiveThemeChartsColumnConfig & { count: number };
  bottom: LiveThemeChartsColumnConfig & { count: number };
  specific: LiveThemeChartsColumnConfig & { themeIds: ClusterId[] };
};

export const DEFAULT_LIVE_THEME_CHARTS_CONFIG: LiveThemeChartsConfig = {
  chartInterval: DEFAULT_LIVE_THEME_CHARTS_CHART_INTERVAL,
  top: { enabled: true, count: 5, snapshotKey: "live" },
  bottom: { enabled: true, count: 5, snapshotKey: "live" },
  specific: {
    enabled: true,
    themeIds: ["SEMIS", "ENTERPRISE_SOFT", "MATERIALS_METALS"],
    snapshotKey: "live",
  },
};

export type LiveThemeChartsColumnKey = "top" | "bottom" | "specific";

export const LIVE_THEME_CHARTS_COLUMN_LABELS: Record<LiveThemeChartsColumnKey, string> = {
  top: "Top themes",
  bottom: "Bottom themes",
  specific: "Picked themes",
};

export function convertThemeMetricsToThemeRow(theme: ThemeMetrics): ThemeRow {
  return {
    id: theme.id as ThemeId,
    name: theme.name,
    tier: theme.tier,
    medianPct: theme.medianPct,
    score: theme.score,
    baseScore: theme.baseScore,
    breadthPct: theme.breadthPct,
    pctAbove50d: theme.pctAbove50d,
    pctAbove200d: theme.pctAbove200d,
    rsVsSpy: theme.rsVsBenchmark ?? theme.rsVsSpy ?? 0,
    volExp: theme.volExp ?? 1.0,
    acceleration: theme.acceleration,
    accDistDays: theme.accDistDays ?? 0,
    rank: theme.rank,
    deltaRank: theme.deltaRank,
    percentile: theme.percentile,
    penaltyFactor: theme.penaltyFactor,
    narrowLeadershipMultiplier: theme.narrowLeadershipMultiplier,
    reasonCodes: theme.reasonCodes as ThemeRow["reasonCodes"],
    coreCount: theme.coreCount,
    leaderCount: theme.greenCount,
    top3Contribution: theme.top3Contribution,
    top3Concentration: theme.top3Concentration ?? 0,
    isNarrowLeadership: theme.isNarrowLeadership ?? false,
    trendState: theme.trendState,
    bullCount: theme.bullCount,
    transitionCount: theme.transitionCount,
    bearCount: theme.bearCount,
    etfProxies: theme.etfProxies as ThemeRow["etfProxies"],
    historicalMetrics: theme.historicalMetrics,
    breakdownWatch: theme.breakdownWatch,
  };
}

function clampCount(n: number): number {
  return Math.max(1, Math.min(LIVE_THEME_CHARTS_MAX_ROWS, Math.floor(n)));
}

function readSnapshotKey(col: Record<string, unknown>, fallback: LiveThemeChartsSnapshotKey): LiveThemeChartsSnapshotKey {
  if (col.snapshotKey === "live") return "live";
  if (typeof col.snapshotKey === "string" && col.snapshotKey.includes("T")) return col.snapshotKey;
  const legacy = String(col.timeSlice ?? "").toUpperCase();
  if (legacy === "TODAY" || legacy === "") return "live";
  return fallback;
}

export function normalizeLiveThemeChartsConfig(raw: unknown): LiveThemeChartsConfig {
  const base = defaultLiveThemeChartsConfig();
  if (!raw || typeof raw !== "object") return { ...base };

  const o = raw as Record<string, unknown>;
  const readCol = <T extends LiveThemeChartsColumnConfig>(
    key: "top" | "bottom" | "specific",
    extra: (col: Record<string, unknown>) => T
  ): T => {
    const def = base[key] as Record<string, unknown>;
    const col =
      o[key] && typeof o[key] === "object" ? (o[key] as Record<string, unknown>) : {};
    return extra({
      enabled: col.enabled !== undefined ? col.enabled === true : def.enabled === true,
      snapshotKey: readSnapshotKey(col, def.snapshotKey as LiveThemeChartsSnapshotKey),
      refetchIntervalMs:
        typeof col.refetchIntervalMs === "number" && col.refetchIntervalMs > 0
          ? col.refetchIntervalMs
          : undefined,
      ...col,
    });
  };

  const top = readCol("top", (col) => ({
    enabled: col.enabled === true,
    count: clampCount(Number(col.count ?? base.top.count)),
    snapshotKey: readSnapshotKey(col, base.top.snapshotKey),
    refetchIntervalMs:
      typeof col.refetchIntervalMs === "number" ? col.refetchIntervalMs : undefined,
  }));

  const bottom = readCol("bottom", (col) => ({
    enabled: col.enabled === true,
    count: clampCount(Number(col.count ?? base.bottom.count)),
    snapshotKey: readSnapshotKey(col, base.bottom.snapshotKey),
    refetchIntervalMs:
      typeof col.refetchIntervalMs === "number" ? col.refetchIntervalMs : undefined,
  }));

  const specific = readCol("specific", (col) => {
    const ids = Array.isArray(col.themeIds)
      ? col.themeIds
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .slice(0, LIVE_THEME_CHARTS_MAX_ROWS)
      : base.specific.themeIds;
    return {
      enabled: col.enabled === true,
      themeIds: ids as ClusterId[],
      snapshotKey: readSnapshotKey(col, base.specific.snapshotKey),
      refetchIntervalMs:
        typeof col.refetchIntervalMs === "number" ? col.refetchIntervalMs : undefined,
    };
  });

  const normalized: LiveThemeChartsConfig = {
    chartInterval: normalizeLiveThemeChartsChartInterval(o.chartInterval ?? base.chartInterval),
    top,
    bottom,
    specific,
  };

  if (!top.enabled && !bottom.enabled && !specific.enabled) {
    return { ...base };
  }
  return normalized;
}

export function enabledLiveThemeChartColumns(
  config: LiveThemeChartsConfig
): LiveThemeChartsColumnKey[] {
  const out: LiveThemeChartsColumnKey[] = [];
  if (config.top.enabled) out.push("top");
  if (config.bottom.enabled) out.push("bottom");
  if (config.specific.enabled) out.push("specific");
  return out;
}

export function uniqueSnapshotKeysForConfig(config: LiveThemeChartsConfig): LiveThemeChartsSnapshotKey[] {
  const keys = new Set<LiveThemeChartsSnapshotKey>();
  for (const col of enabledLiveThemeChartColumns(config)) {
    keys.add(config[col].snapshotKey);
  }
  return [...keys];
}

export function resolveThemesForColumn(
  column: LiveThemeChartsColumnKey,
  config: LiveThemeChartsConfig,
  themes: ThemeRow[]
): ThemeRow[] {
  const sorted = [...themes].sort((a, b) => a.rank - b.rank);
  if (column === "top") {
    return sorted.slice(0, clampCount(config.top.count));
  }
  if (column === "bottom") {
    return [...sorted].reverse().slice(0, clampCount(config.bottom.count));
  }
  const byId = new Map(sorted.map((t) => [t.id, t]));
  return config.specific.themeIds
    .map((id) => byId.get(id as ThemeId))
    .filter((t): t is ThemeRow => t != null);
}

export function validateLiveThemeChartsConfig(config: LiveThemeChartsConfig): string | null {
  if (!config.top.enabled && !config.bottom.enabled && !config.specific.enabled) {
    return "Enable at least one column.";
  }
  if (config.top.enabled && (config.top.count < 1 || config.top.count > LIVE_THEME_CHARTS_MAX_ROWS)) {
    return `Top count must be 1–${LIVE_THEME_CHARTS_MAX_ROWS}.`;
  }
  if (
    config.bottom.enabled &&
    (config.bottom.count < 1 || config.bottom.count > LIVE_THEME_CHARTS_MAX_ROWS)
  ) {
    return `Bottom count must be 1–${LIVE_THEME_CHARTS_MAX_ROWS}.`;
  }
  if (config.specific.enabled && config.specific.themeIds.length === 0) {
    return "Pick at least one theme for the specific column.";
  }
  if (
    config.specific.enabled &&
    config.specific.themeIds.length > LIVE_THEME_CHARTS_MAX_ROWS
  ) {
    return `Specific column supports at most ${LIVE_THEME_CHARTS_MAX_ROWS} themes.`;
  }
  return null;
}
