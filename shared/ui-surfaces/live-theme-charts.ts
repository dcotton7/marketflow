import type { UiSurfaceDef } from "./types";

const THEME_BOX_MS = 15 * 60_000;
const CHART_STREAM_MS = 60_000;

/**
 * Live Theme Charts — Start Here widget (`themeCharts` instance type).
 * Product name: **Live Theme Charts**. Code surface id: **liveThemeCharts**.
 */
export const LIVE_THEME_CHARTS_SURFACE: UiSurfaceDef = {
  id: "liveThemeCharts",
  displayName: "Live Theme Charts",
  refreshTiers: {
    themeStream: undefined,
    memberStream: undefined,
    themeBox: {
      id: "themeBox",
      defaultIntervalMs: THEME_BOX_MS,
      description:
        "Rank, scorecard, breakdown, member highlights — aligned to 15m ET snapshot cadence.",
    },
    chartStream: {
      id: "chartStream",
      defaultIntervalMs: CHART_STREAM_MS,
      description: "Mini chart OHLC / MA / ADRS (STOCK_HISTORY_INTRADAY_REFETCH_MS).",
    },
    snapshotHistory: {
      id: "snapshotHistory",
      defaultIntervalMs: THEME_BOX_MS,
      description: "Historical column baselines via snapshotAt ISO slots.",
    },
    benchmarkStrip: undefined,
  },
  regions: {
    widgetChrome: {
      id: "widgetChrome",
      displayName: "Widget chrome",
      notes: "StartHereWidgetChrome frame.",
    },
    widgetHeader: {
      id: "widgetHeader",
      displayName: "Widget header",
      parent: "widgetChrome",
    },
    widgetTitle: {
      id: "widgetTitle",
      displayName: "Widget title",
      parent: "widgetHeader",
    },
    widgetToolbar: {
      id: "widgetToolbar",
      displayName: "Widget toolbar",
      parent: "widgetHeader",
    },
    chartIntervalToggle: {
      id: "chartIntervalToggle",
      displayName: "Chart interval toggle",
      parent: "widgetToolbar",
      notes: "Bar size (5m/15m/30m/1d), not theme-box refresh rate.",
    },
    widgetBody: {
      id: "widgetBody",
      displayName: "Widget body",
      parent: "widgetChrome",
    },
    cadenceStrip: {
      id: "cadenceStrip",
      displayName: "Cadence strip",
      parent: "widgetBody",
    },
    columnGrid: {
      id: "columnGrid",
      displayName: "Column grid",
      parent: "widgetBody",
    },
    themeColumn: {
      id: "themeColumn",
      displayName: "Theme column",
      parent: "columnGrid",
      refreshTier: "themeBox",
    },
    colHeader: {
      id: "colHeader",
      displayName: "Column header",
      parent: "themeColumn",
    },
    snapshotBadge: {
      id: "snapshotBadge",
      displayName: "Snapshot badge",
      parent: "colHeader",
    },
    themeRow: {
      id: "themeRow",
      displayName: "Theme row",
      parent: "themeColumn",
    },
    rowHeader: {
      id: "rowHeader",
      displayName: "Row header",
      parent: "themeRow",
      refreshTier: "themeBox",
    },
    themeIdentity: {
      id: "themeIdentity",
      displayName: "Theme identity",
      parent: "rowHeader",
    },
    rankStrip: {
      id: "rankStrip",
      displayName: "Rank strip",
      parent: "rowHeader",
      refreshTier: "themeBox",
    },
    rowBody: {
      id: "rowBody",
      displayName: "Row body",
      parent: "themeRow",
    },
    chartPane: {
      id: "chartPane",
      displayName: "Chart pane",
      parent: "rowBody",
      refreshTier: "chartStream",
    },
    miniChart: {
      id: "miniChart",
      displayName: "Mini chart",
      parent: "chartPane",
      refreshTier: "chartStream",
    },
    maLegendOverlay: {
      id: "maLegendOverlay",
      displayName: "MA legend overlay",
      parent: "miniChart",
    },
    dataUpdatedStamp: {
      id: "dataUpdatedStamp",
      displayName: "Data updated stamp",
      parent: "miniChart",
    },
    themeBox: {
      id: "themeBox",
      displayName: "Theme box",
      parent: "rowBody",
      refreshTier: "themeBox",
      notes: "Right pane — status, metrics, segments, verdict, member chips.",
    },
    statusRow: {
      id: "statusRow",
      displayName: "Status row",
      parent: "themeBox",
    },
    coreMetrics: {
      id: "coreMetrics",
      displayName: "Core metrics",
      parent: "themeBox",
    },
    segmentBars: {
      id: "segmentBars",
      displayName: "Segment bars",
      parent: "themeBox",
    },
    verdict: {
      id: "verdict",
      displayName: "Verdict",
      parent: "themeBox",
    },
    memberChips: {
      id: "memberChips",
      displayName: "Member chips",
      parent: "themeBox",
    },
    configDialog: {
      id: "configDialog",
      displayName: "Configure dialog",
      parent: "widgetChrome",
    },
    popoutSurface: {
      id: "popoutSurface",
      displayName: "Pop-out surface",
      parent: "widgetChrome",
    },
  },
};

/** Column kind ids — match LiveThemeChartsColumnKey. */
export const LIVE_THEME_CHARTS_COLUMN_KINDS = ["top", "bottom", "specific"] as const;
export type LiveThemeChartsColumnKind = (typeof LIVE_THEME_CHARTS_COLUMN_KINDS)[number];

export const LIVE_THEME_CHARTS_COLUMN_LABELS: Record<LiveThemeChartsColumnKind, string> = {
  top: "Leaders column",
  bottom: "Laggards column",
  specific: "Watchlist column",
};
