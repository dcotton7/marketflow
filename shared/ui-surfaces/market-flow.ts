import type { UiSurfaceDef } from "./types";

const THEME_STREAM_MS = 60_000;
const MEMBER_STREAM_MS = 60_000;
const SNAPSHOT_HISTORY_MS = 15 * 60_000;

/**
 * MarketFlow — `/sentinel/market-condition` (MarketConditionPage).
 * Product name: **MarketFlow**. Code surface id: **marketFlow**.
 */
export const MARKET_FLOW_SURFACE: UiSurfaceDef = {
  id: "marketFlow",
  displayName: "MarketFlow",
  route: "/sentinel/market-condition",
  refreshTiers: {
    themeStream: {
      id: "themeStream",
      defaultIntervalMs: THEME_STREAM_MS,
      description:
        "Live theme rankings, scores, heatmap/table/race data (admin clientThemesRefetchIntervalMs).",
    },
    memberStream: {
      id: "memberStream",
      defaultIntervalMs: MEMBER_STREAM_MS,
      description:
        "Selected theme member rows, MA columns (admin clientTickersRefetchIntervalMs).",
    },
    themeBox: undefined,
    chartStream: undefined,
    snapshotHistory: {
      id: "snapshotHistory",
      defaultIntervalMs: SNAPSHOT_HISTORY_MS,
      description:
        "Stored theme_snapshots (15m ET) — Race timeline, Flow Map baselines, historical comparison.",
    },
    benchmarkStrip: {
      id: "benchmarkStrip",
      defaultIntervalMs: THEME_STREAM_MS,
      description: "QQQ / IWM / MDY / SPY strip always fetched on TODAY live poll.",
    },
  },
  regions: {
    pageShell: {
      id: "pageShell",
      displayName: "Page shell",
      notes: "Full-screen MarketFlow layout root.",
    },
    appNav: {
      id: "appNav",
      displayName: "App navigation",
      parent: "pageShell",
      notes: "SentinelHeader — global nav, not MarketFlow-specific.",
    },
    regimeBar: {
      id: "regimeBar",
      displayName: "Regime bar",
      parent: "pageShell",
      refreshTier: "themeStream",
      notes: "HeaderBar — RAI, regime, mega overlay, benchmarks.",
    },
    regimeBranding: {
      id: "regimeBranding",
      displayName: "MarketFlow branding",
      parent: "regimeBar",
    },
    regimeBadge: {
      id: "regimeBadge",
      displayName: "Market regime",
      parent: "regimeBar",
    },
    raiGauge: {
      id: "raiGauge",
      displayName: "RAI gauge",
      parent: "regimeBar",
    },
    megaOverlay: {
      id: "megaOverlay",
      displayName: "Mega cap overlay",
      parent: "regimeBar",
    },
    sessionBadge: {
      id: "sessionBadge",
      displayName: "Session badge",
      parent: "regimeBar",
      notes: "OPEN / AFTER / CLOSE — always visible after Market Flow branding.",
    },
    universeBreadthBar: {
      id: "universeBreadthBar",
      displayName: "Universe breadth bar",
      parent: "regimeBar",
      refreshTier: "themeStream",
      notes: "Green % up / red % down across tracked universe tickers.",
    },
    benchmarkStrip: {
      id: "benchmarkStrip",
      displayName: "Benchmark strip",
      parent: "regimeBar",
      refreshTier: "benchmarkStrip",
      notes: "QQQ, IWM, MDY, SPY % change.",
    },
    marketHealth: {
      id: "marketHealth",
      displayName: "Market health",
      parent: "regimeBar",
    },
    statusBanners: {
      id: "statusBanners",
      displayName: "Status banners",
      parent: "pageShell",
    },
    apiErrorBanner: {
      id: "apiErrorBanner",
      displayName: "API error banner",
      parent: "statusBanners",
    },
    comparisonBanner: {
      id: "comparisonBanner",
      displayName: "Comparison unavailable banner",
      parent: "statusBanners",
    },
    commandToolbar: {
      id: "commandToolbar",
      displayName: "Command toolbar",
      parent: "pageShell",
    },
    pageTitle: {
      id: "pageTitle",
      displayName: "Page title",
      parent: "commandToolbar",
      notes: "Market Condition / Flow Mode + LIVE badge.",
    },
    dataSourceToggle: {
      id: "dataSourceToggle",
      displayName: "Live / mock toggle",
      parent: "commandToolbar",
    },
    forceRefresh: {
      id: "forceRefresh",
      displayName: "Force refresh",
      parent: "commandToolbar",
    },
    lensSwitcher: {
      id: "lensSwitcher",
      displayName: "Lens switcher",
      parent: "commandToolbar",
      notes: "flow | flowMap | rotation | concentration | accumulation | race",
    },
    accDistFilter: {
      id: "accDistFilter",
      displayName: "A/D filter",
      parent: "commandToolbar",
    },
    timeSliceSelector: {
      id: "timeSliceSelector",
      displayName: "Time slice selector",
      parent: "commandToolbar",
    },
    universeSearch: {
      id: "universeSearch",
      displayName: "Universe search",
      parent: "commandToolbar",
      notes: "Theme, sub-theme, ticker search popover.",
    },
    sizeFilter: {
      id: "sizeFilter",
      displayName: "Size filter",
      parent: "commandToolbar",
    },
    viewModeToggle: {
      id: "viewModeToggle",
      displayName: "View mode toggle",
      parent: "commandToolbar",
      notes: "grid | table | split",
    },
    panelVisibility: {
      id: "panelVisibility",
      displayName: "Panel visibility",
      parent: "commandToolbar",
    },
    fullscreenToggle: {
      id: "fullscreenToggle",
      displayName: "Fullscreen toggle",
      parent: "commandToolbar",
    },
    workspace: {
      id: "workspace",
      displayName: "Workspace",
      parent: "pageShell",
    },
    themeTrackerPanel: {
      id: "themeTrackerPanel",
      displayName: "Theme tracker panel",
      parent: "workspace",
      refreshTier: "themeStream",
      notes: "Left/top primary panel — content depends on lens + view mode.",
    },
    heatmapSortToggle: {
      id: "heatmapSortToggle",
      displayName: "Heatmap sort toggle",
      parent: "themeTrackerPanel",
      notes: "Current vs historical sort (flow/rotation lenses).",
    },
    themeHeatmap: {
      id: "themeHeatmap",
      displayName: "Theme heatmap",
      parent: "themeTrackerPanel",
      refreshTier: "themeStream",
    },
    flowMapMatrix: {
      id: "flowMapMatrix",
      displayName: "Flow map matrix",
      parent: "themeTrackerPanel",
      refreshTier: "themeStream",
      notes: "Pairwise theme-to-theme rotation grid.",
    },
    flowMapControls: {
      id: "flowMapControls",
      displayName: "Flow map controls",
      parent: "flowMapMatrix",
      notes: "Timeframe columns, comp baseline, sort, help overlay.",
    },
    themeRace: {
      id: "themeRace",
      displayName: "Theme race",
      parent: "themeTrackerPanel",
      refreshTier: "snapshotHistory",
      notes: "Timeline lanes from snapshots or live fallback.",
    },
    raceTransport: {
      id: "raceTransport",
      displayName: "Race transport",
      parent: "themeRace",
      notes: "Play/pause, scrubber, range selector.",
    },
    focusedThemePanel: {
      id: "focusedThemePanel",
      displayName: "Focused theme panel",
      parent: "workspace",
      refreshTier: "themeStream",
    },
    detailTabBar: {
      id: "detailTabBar",
      displayName: "Detail tab bar",
      parent: "focusedThemePanel",
    },
    actionableDetails: {
      id: "actionableDetails",
      displayName: "Actionable details",
      parent: "focusedThemePanel",
      refreshTier: "themeStream",
      notes: "Theme box equivalent — status, segments, breakdown watch.",
    },
    subthemesList: {
      id: "subthemesList",
      displayName: "Sub-themes list",
      parent: "focusedThemePanel",
    },
    etfProxies: {
      id: "etfProxies",
      displayName: "ETF proxies",
      parent: "focusedThemePanel",
    },
    flowFocus: {
      id: "flowFocus",
      displayName: "Flow focus",
      parent: "focusedThemePanel",
      notes: "Route detail from Flow Map selection.",
    },
    legacyDetails: {
      id: "legacyDetails",
      displayName: "Legacy details",
      parent: "focusedThemePanel",
    },
    membersPanel: {
      id: "membersPanel",
      displayName: "Members panel",
      parent: "workspace",
      refreshTier: "memberStream",
    },
    memberScopeToggle: {
      id: "memberScopeToggle",
      displayName: "Member scope toggle",
      parent: "membersPanel",
      notes: "Leaders | All theme | Sub-theme.",
    },
    tickerWorkbench: {
      id: "tickerWorkbench",
      displayName: "Ticker workbench",
      parent: "membersPanel",
      refreshTier: "memberStream",
    },
    memberTable: {
      id: "memberTable",
      displayName: "Member table",
      parent: "tickerWorkbench",
    },
    memberMaColumns: {
      id: "memberMaColumns",
      displayName: "MA column pickers",
      parent: "tickerWorkbench",
    },
    memberSyncToggles: {
      id: "memberSyncToggles",
      displayName: "Sync toggles",
      parent: "tickerWorkbench",
      notes: "MarketSurge, chart popout, analysis sync.",
    },
    rotationTablePanel: {
      id: "rotationTablePanel",
      displayName: "Rotation table panel",
      parent: "workspace",
      refreshTier: "themeStream",
    },
    rotationTable: {
      id: "rotationTable",
      displayName: "Rotation table",
      parent: "rotationTablePanel",
    },
    racePopout: {
      id: "racePopout",
      displayName: "Race pop-out",
      parent: "pageShell",
      notes: "Dialog overlay for expanded Theme Race.",
    },
    analysisPanel: {
      id: "analysisPanel",
      displayName: "Analysis panel",
      parent: "pageShell",
      notes: "Floating AI analysis sheet (MarketFlow analysis).",
    },
  },
};

/** Lens mode ids — match MarketConditionPage LensMode. */
export const MARKET_FLOW_LENS_IDS = [
  "flow",
  "flowMap",
  "rotation",
  "concentration",
  "accumulation",
  "race",
] as const;

export type MarketFlowLensId = (typeof MARKET_FLOW_LENS_IDS)[number];

export const MARKET_FLOW_LENS_LABELS: Record<MarketFlowLensId, string> = {
  flow: "Flow",
  flowMap: "Flow Map",
  rotation: "Rotation",
  concentration: "Concentration",
  accumulation: "A/D",
  race: "Race",
};

/** View layout ids — match MarketConditionPage ViewMode. */
export const MARKET_FLOW_VIEW_IDS = ["grid", "table", "split"] as const;
export type MarketFlowViewId = (typeof MARKET_FLOW_VIEW_IDS)[number];
