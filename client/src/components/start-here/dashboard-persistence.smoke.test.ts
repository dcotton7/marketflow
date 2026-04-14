/**
 * Start Here dashboard persistence smoke checks.
 * Run with: tsx client/src/components/start-here/dashboard-persistence.smoke.test.ts
 */

import {
  addChartFromWatchlistSymbol,
  appendLinkedChartTriplet,
  createDefaultDashboard,
  loadChartsFromList,
  setChartSymbolOverrideOnInstance,
  type StartHereDashboardV2,
} from "./dashboard-persistence";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function withWatchlistGroup(
  dashboard: StartHereDashboardV2,
  groupId: string,
  symbol: string,
  colorIndex: number
): StartHereDashboardV2 {
  return {
    ...dashboard,
    groups: {
      ...dashboard.groups,
      [groupId]: {
        colorIndex,
        accentColorIndex: colorIndex,
        symbol,
      },
    },
  };
}

function testSpawnChartInheritsGroupIdentity(): void {
  const gid = "sh_lane_smoke";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "QQQ", 4);
  const next = addChartFromWatchlistSymbol(seed, "AMD", { inheritGroupId: gid });
  const newChartEntry = Object.entries(next.instances).find(
    ([id, meta]) => !seed.instances[id] && meta.type === "chart"
  );
  assert(!!newChartEntry, "Expected one new chart instance");
  const [, chartMeta] = newChartEntry!;
  assert(chartMeta.groupId === gid, "Spawned chart should keep watchlist group id");
  assert(
    chartMeta.chartSymbolOverride === "AMD",
    "Spawned chart should keep clicked symbol as override when lane symbol differs"
  );
}

function testBulkLoadInheritsGroupIdentity(): void {
  const gid = "sh_lane_bulk";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "SPY", 2);
  const { dashboard: next, placed, skipped } = loadChartsFromList(seed, ["AMD", "NVDA"], {
    inheritGroupId: gid,
  });
  assert(placed === 2, "Expected two charts placed");
  assert(skipped === 0, "Expected zero skipped");
  const addedCharts = Object.entries(next.instances).filter(
    ([id, meta]) => !seed.instances[id] && meta.type === "chart"
  );
  assert(addedCharts.length === 2, "Expected two new chart meta records");
  for (const [, meta] of addedCharts) {
    assert(meta.groupId === gid, "Bulk-loaded chart should use source watchlist group");
  }
}

function testLinkedTripletHasColorAndSyncsSymbol(): void {
  const seed = createDefaultDashboard();
  const next = appendLinkedChartTriplet(seed);
  const addedCharts = Object.entries(next.instances).filter(
    ([id, meta]) => !seed.instances[id] && meta.type === "chart" && meta.linkedSetLocked
  );
  assert(addedCharts.length === 3, "Expected three locked linked charts");
  const linkedGroupId = addedCharts[0]![1].groupId;
  const linkedGroup = next.groups[linkedGroupId];
  assert(!!linkedGroup, "Linked chart group must exist");
  assert(
    linkedGroup.accentColorIndex != null,
    "Linked chart group should have non-null accent color index"
  );
  const updated = setChartSymbolOverrideOnInstance(next, addedCharts[0]![0], "TSLA");
  assert(
    updated.groups[linkedGroupId]?.symbol === "TSLA",
    "Typing on one linked chart should broadcast to shared group symbol"
  );
}

function runAll(): void {
  testSpawnChartInheritsGroupIdentity();
  testBulkLoadInheritsGroupIdentity();
  testLinkedTripletHasColorAndSyncsSymbol();
  console.log("✅ Start Here dashboard persistence smoke tests passed");
}

runAll();

