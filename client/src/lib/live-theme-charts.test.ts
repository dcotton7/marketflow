import {
  DEFAULT_LIVE_THEME_CHARTS_CONFIG,
  estimateThemeChartsContentHeightPx,
  formatAdrs50smaLine,
  formatAtrx50maLine,
  getLeadingDirectEtfSymbol,
  maxThemeChartRowsInConfig,
  normalizeLiveThemeChartsConfig,
  resolveThemesForColumn,
  validateLiveThemeChartsConfig,
} from "@/lib/live-theme-charts";
import type { ThemeRow } from "@/data/mockThemeData";
import { MOCK_THEMES } from "@/data/mockThemeData";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function testDefaultConfig() {
  const c = DEFAULT_LIVE_THEME_CHARTS_CONFIG;
  assert(c.chartInterval === "30m", "default chart interval 30m");
  assert(c.top.enabled && c.top.count === 5, "top 5 default");
  assert(c.bottom.enabled && c.bottom.count === 5, "bottom 5 default");
  assert(c.specific.enabled && c.specific.themeIds.length === 3, "specific 3 default");
  assert(
    c.specific.themeIds.join(",") === "SEMIS,ENTERPRISE_SOFT,MATERIALS_METALS",
    "specific theme ids"
  );
  assert(validateLiveThemeChartsConfig(c) === null, "default valid");
}

function testLeadingEtf() {
  const semis = MOCK_THEMES.find((t) => t.id === "SEMIS");
  assert(!!semis, "SEMIS mock");
  assert(
    getLeadingDirectEtfSymbol({
      etfProxies: [{ symbol: "SMH", name: "SMH", proxyType: "direct" }],
    }) === "SMH",
    "SMH for direct proxy"
  );
  assert(getLeadingDirectEtfSymbol(semis!) === null, "mock SEMIS has no proxies");
}

function testResolveTopBottom() {
  const rows: ThemeRow[] = MOCK_THEMES.slice(0, 6).map((t, i) => ({
    ...t,
    rank: i + 1,
  }));
  const top = resolveThemesForColumn("top", { ...DEFAULT_LIVE_THEME_CHARTS_CONFIG, top: { ...DEFAULT_LIVE_THEME_CHARTS_CONFIG.top, count: 3 } }, rows);
  assert(top.length === 3 && top[0]!.rank === 1, "top 3 by rank");
  const bottom = resolveThemesForColumn(
    "bottom",
    { ...DEFAULT_LIVE_THEME_CHARTS_CONFIG, bottom: { ...DEFAULT_LIVE_THEME_CHARTS_CONFIG.bottom, count: 2 } },
    rows
  );
  assert(bottom.length === 2 && bottom[0]!.rank === 6, "bottom 2");
}

function testNormalizeAndValidate() {
  const disabled = normalizeLiveThemeChartsConfig({
    top: { enabled: false, count: 5, snapshotKey: "live" },
    bottom: { enabled: false, count: 5, snapshotKey: "live" },
    specific: { enabled: false, themeIds: [], snapshotKey: "live" },
  });
  assert(disabled.top.enabled === true, "fallback when all disabled");

  const bad = { ...DEFAULT_LIVE_THEME_CHARTS_CONFIG, top: { ...DEFAULT_LIVE_THEME_CHARTS_CONFIG.top, count: 12 } };
  assert(validateLiveThemeChartsConfig(bad) !== null, "reject count > 8");

  const migrated = normalizeLiveThemeChartsConfig({
    top: { enabled: true, count: 5, timeSlice: "15M" },
    bottom: { enabled: true, count: 5, timeSlice: "TODAY" },
    specific: { enabled: true, themeIds: ["SEMIS"], timeSlice: "TODAY" },
  });
  assert(migrated.chartInterval === "30m", "missing chartInterval defaults to 30m");
  assert(migrated.top.snapshotKey === "live", "legacy relative slice maps to live");
  assert(migrated.bottom.snapshotKey === "live", "legacy TODAY maps to live");
}

function testAdrsLineFormat() {
  assert(formatAdrs50smaLine(2.3) === "#ADRS-50sma: 2.3#", "positive suffix hash");
  assert(formatAdrs50smaLine(-1.2) === "#ADRS-50sma: 1.2 (-1.2)", "negative parens");
}

function testAtrx50maLineFormat() {
  assert(formatAtrx50maLine(2.3) === "ATRx50ma: 2.3 ATRs above 50d", "above 50d");
  assert(formatAtrx50maLine(-1.2) === "ATRx50ma: 1.2 ATRs below 50d", "below 50d");
  assert(formatAtrx50maLine(null) === "ATRx50ma: --", "missing data");
}

function testDefaultHeight() {
  assert(maxThemeChartRowsInConfig(DEFAULT_LIVE_THEME_CHARTS_CONFIG) === 5, "default max 5 rows");
  const px = estimateThemeChartsContentHeightPx(DEFAULT_LIVE_THEME_CHARTS_CONFIG);
  assert(px >= 1100, "default content height fits 5 full rows");
}

function run() {
  testDefaultConfig();
  testLeadingEtf();
  testResolveTopBottom();
  testNormalizeAndValidate();
  testAdrsLineFormat();
  testAtrx50maLineFormat();
  testDefaultHeight();
  console.log("live-theme-charts.test.ts: all passed");
}

run();
