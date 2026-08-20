/**
 * Start Here dashboard persistence smoke checks.
 * Run with: tsx client/src/components/start-here/dashboard-persistence.smoke.test.ts
 */

import {
  chartEffectiveSymbol,
  addChartFromWatchlistSymbol,
  appendLinkedChartTriplet,
  clearAllWidgets,
  createDefaultDashboard,
  findBulkChartGridPlacement,
  loadChartsFromList,
  reflowWatchlistChartWalls,
  removeInstance,
  resolveBulkChartCellsForViewport,
  resolveChartsPerRowPreference,
  sanitizeDashboard,
  setChartSymbolOverrideOnInstance,
  startHereGridViewportMetrics,
  START_HERE_RGL_ROW_HEIGHT,
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
  const { dashboard: next, placed, skipped, removed } = loadChartsFromList(seed, ["AMD", "NVDA"], {
    inheritGroupId: gid,
  });
  assert(placed === 2, "Expected two charts placed");
  assert(skipped === 0, "Expected zero skipped");
  assert(removed === 0, "Expected zero removed on first load");
  const addedCharts = Object.entries(next.instances).filter(
    ([id, meta]) => !seed.instances[id] && meta.type === "chart"
  );
  assert(addedCharts.length === 2, "Expected two new chart meta records");
  for (const [, meta] of addedCharts) {
    assert(meta.groupId === gid, "Bulk-loaded chart should use source watchlist group");
  }
}

function testBulkLoadSyncSkipsDuplicates(): void {
  const gid = "sh_lane_sync_dup";
  const wl = "sh_watchlist_dup";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "SPY", 2);
  seed.instances[wl] = { type: "watchlist", groupId: gid };
  const first = loadChartsFromList(seed, ["AMD", "NVDA"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: wl,
  });
  assert(first.placed === 2, "Expected two charts on first load");
  const second = loadChartsFromList(first.dashboard, ["AMD", "NVDA"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: wl,
  });
  assert(second.placed === 0, "Expected no new charts on repeat load");
  assert(second.removed === 0, "Expected no removals on repeat load");
  const chartCount = Object.values(second.dashboard.instances).filter(
    (m) => m.type === "chart" && m.groupId === gid
  ).length;
  assert(chartCount === 2, "Expected exactly two chart tiles in watchlist group after repeat load");
}

function testBulkLoadSyncRemovesStaleAndAddsNew(): void {
  const gid = "sh_lane_sync_delta";
  const wl = "sh_watchlist_sync";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "SPY", 2);
  seed.instances[wl] = { type: "watchlist", groupId: gid };
  const first = loadChartsFromList(seed, ["AMD", "NVDA", "INTC"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: wl,
  });
  assert(first.placed === 3, "Expected three charts on first load");
  const second = loadChartsFromList(first.dashboard, ["AMD", "MSFT"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: wl,
  });
  assert(second.placed === 2, "Expected AMD and MSFT re-added after list change");
  assert(second.removed === 3, "Expected prior three charts cleared before reload");
  const symbols = Object.entries(second.dashboard.instances)
    .filter(([, meta]) => meta.type === "chart" && meta.groupId === gid)
    .map(([id]) => chartEffectiveSymbol(second.dashboard, id))
    .filter((s): s is string => Boolean(s));
  assert(symbols.includes("AMD"), "AMD chart should remain");
  assert(symbols.includes("MSFT"), "MSFT chart should be added");
  assert(!symbols.includes("NVDA"), "NVDA chart should be removed");
  assert(!symbols.includes("INTC"), "INTC chart should be removed");
}

function testLinkedTripletHasColorAndSyncsSymbol(): void {
  const seed = createDefaultDashboard();
  const next = appendLinkedChartTriplet(seed);
  const addedCharts = Object.entries(next.instances).filter(
    ([id, meta]) => !seed.instances[id] && meta.type === "chart" && meta.linkedSetLocked
  );
  assert(addedCharts.length === 4, "Expected four locked linked charts");
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

function testViewportMetricsAdaptToWidth(): void {
  const ultraWide = startHereGridViewportMetrics(1920, 900);
  assert(ultraWide.chartsPerRow === 6, "Ultra-wide Auto should pack 6 charts per row");
  assert(ultraWide.bulkChartCells.w === 2, "Ultra-wide chart width should be w=2");

  const wide = startHereGridViewportMetrics(1600, 900);
  assert(wide.chartsPerRow === 5, "Wide Auto should pack 5 charts per row");

  const narrow = startHereGridViewportMetrics(640, 900);
  assert(narrow.bulkChartCells.w === 12, "Narrow viewport should use full-width chart tiles");
  assert(narrow.chartsPerRow === 1, "Narrow viewport chartsPerRow should be 1");

  const portrait = startHereGridViewportMetrics(900, 520);
  assert(
    portrait.bulkChartCells.h <= resolveBulkChartCellsForViewport(900, 1100).h,
    "Short viewport should use shorter chart tiles than tall viewport"
  );

  const manualFive = startHereGridViewportMetrics(1200, 900, 5);
  assert(manualFive.chartsPerRow === 5, "Manual 5 per row should override Auto");
}

function testBulkRowMajorPlacement(): void {
  const seed = createDefaultDashboard();
  const chartsPerRow = resolveChartsPerRowPreference(1500, "auto");
  const cells = resolveBulkChartCellsForViewport(1500, 900, START_HERE_RGL_ROW_HEIGHT, "auto");
  const layout = [...seed.layout];
  let cursor: { x: number; y: number; chartsInRow?: number } | null = null;
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const packed = findBulkChartGridPlacement(
      layout,
      cells.w,
      cells.h,
      12,
      null,
      cursor,
      chartsPerRow
    );
    assert(!!packed, `Expected placement ${i}`);
    layout.push({
      i: `test_${i}`,
      x: packed!.pos.x,
      y: packed!.pos.y,
      w: cells.w,
      h: cells.h,
    });
    positions.push(packed!.pos);
    cursor = packed!.nextCursor;
  }
  assert(positions[0]!.y === positions[chartsPerRow - 1]!.y, "First row should stay on same y");
  assert(positions[chartsPerRow]!.y > positions[0]!.y, "Next row should wrap after density cap");
}

function testBulkLoadUsesViewportCells(): void {
  const gid = "sh_lane_viewport";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "SPY", 2);
  const viewport = startHereGridViewportMetrics(1600, 900, 5);
  const { dashboard: next, placed } = loadChartsFromList(seed, ["AMD", "NVDA", "MSFT", "GOOG"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: "sh_watchlist_viewport",
    gridViewport: viewport,
  });
  assert(placed === 4, "Expected four charts placed with viewport pack");
  assert(viewport.chartsPerRow === 5, "Fixture should use manual 5 per row");
  const added = next.layout.filter((l) => !seed.layout.some((s) => s.i === l.i));
  assert(added.length === 4, "Expected four new layout items");
  for (const li of added) {
    assert(li.w === viewport.bulkChartCells.w, "Bulk charts should use viewport width");
    assert(li.h === viewport.bulkChartCells.h, "Bulk charts should use viewport height");
  }
}

function testReflowWatchlistChartWallsOnDensityChange(): void {
  const gid = "sh_lane_reflow";
  const wl = "sh_watchlist_reflow";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "SPY", 2);
  seed.instances[wl] = { type: "watchlist", groupId: gid };
  const loaded = loadChartsFromList(seed, ["AMD", "NVDA", "MSFT", "GOOG", "META"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: wl,
    gridViewport: startHereGridViewportMetrics(1600, 900, 5),
  }).dashboard;
  const before = loaded.layout.filter((l) => loaded.instances[l.i]?.type === "chart" && l.i !== seed.defaultChartInstanceId);
  assert(before.length === 5, "Expected five watchlist charts before reflow");

  const { dashboard: reflowed, reflowed: count } = reflowWatchlistChartWalls(
    loaded,
    2,
    { clientWidthPx: 1600, clientHeightPx: 900, suggestedRowHeight: START_HERE_RGL_ROW_HEIGHT }
  );
  assert(count === 5, "Expected five charts reflowed");
  const after = reflowed.layout.filter((l) => reflowed.instances[l.i]?.watchlistLoadSourceId === wl);
  assert(after.length === 5, "Expected five watchlist charts after reflow");
  assert(after[0]!.w === 6, "Chart width should follow 2-per-row density (w=6)");
  const rows = new Set(after.map((l) => l.y));
  assert(rows.size >= 2, "Two per row should span multiple rows for five charts");
}

/**
 * Closing the watchlist tile must not strand the wall it built.
 *
 * The charts keep the tag naming the watchlist that spawned them, and that tag
 * outlives the tile. Reflowing only walls whose watchlist is still on the page
 * left the density control changing its own value and moving nothing, which
 * reads as a dead control rather than one that no longer applies.
 */
function testReflowSurvivesClosingTheWatchlist(): void {
  const gid = "sh_lane_orphan";
  const wl = "sh_watchlist_orphan";
  const seed = withWatchlistGroup(createDefaultDashboard(), gid, "SPY", 2);
  seed.instances[wl] = { type: "watchlist", groupId: gid };
  const loaded = loadChartsFromList(seed, ["AMD", "NVDA", "MSFT", "GOOG", "META"], {
    inheritGroupId: gid,
    watchlistLoadSourceId: wl,
    gridViewport: startHereGridViewportMetrics(1600, 900, 5),
  }).dashboard;

  const closed = removeInstance(loaded, wl);
  assert(!closed.instances[wl], "Watchlist tile should be gone");
  const stillTagged = Object.values(closed.instances).filter(
    (m) => m.type === "chart" && m.watchlistLoadSourceId === wl
  ).length;
  assert(stillTagged === 5, `Expected five charts still tagged to the closed watchlist, got ${stillTagged}`);

  const { dashboard: reflowed, reflowed: count } = reflowWatchlistChartWalls(closed, 2, {
    clientWidthPx: 1600,
    clientHeightPx: 900,
    suggestedRowHeight: START_HERE_RGL_ROW_HEIGHT,
  });
  assert(count === 5, `Expected five charts reflowed after closing the watchlist, got ${count}`);
  const after = reflowed.layout.filter((l) => reflowed.instances[l.i]?.watchlistLoadSourceId === wl);
  assert(after.every((l) => l.w === 6), "Every orphaned chart should take the 2-per-row width");
  const rows = new Set(after.map((l) => l.y));
  assert(rows.size >= 2, "Five charts at two per row should span multiple rows");
}

/**
 * A board the user built by hand is a wall too.
 *
 * Live boards exist with charts on them and no watchlist anywhere on the page.
 * Nothing on such a board carries a watchlist tag, so density had no wall to
 * pack: the control changed its own value and every chart stayed where it was.
 */
function testReflowPacksHandPlacedCharts(): void {
  let dash = createDefaultDashboard();
  for (const [id, meta] of Object.entries(dash.instances)) {
    if (meta.type === "watchlist") dash = removeInstance(dash, id);
  }
  for (const sym of ["AMD", "NVDA", "MSFT", "GOOG"]) {
    dash = addChartFromWatchlistSymbol(dash, sym);
  }
  assert(
    !Object.values(dash.instances).some((m) => m.type === "watchlist"),
    "Fixture should have no watchlist widget on the page"
  );
  const hand = Object.entries(dash.instances).filter(
    ([id, m]) => m.type === "chart" && !m.linkedSetLocked && id !== dash.defaultChartInstanceId
  );
  assert(hand.length === 4, `Expected four hand-placed charts, got ${hand.length}`);
  assert(
    hand.every(([, m]) => !m.watchlistLoadSourceId),
    "Hand-placed charts should carry no watchlist tag"
  );

  const { dashboard: reflowed, reflowed: count } = reflowWatchlistChartWalls(dash, 2, {
    clientWidthPx: 1600,
    clientHeightPx: 900,
    suggestedRowHeight: START_HERE_RGL_ROW_HEIGHT,
  });
  assert(count === 4, `Expected four hand-placed charts reflowed, got ${count}`);
  const handIds = new Set(hand.map(([id]) => id));
  const after = reflowed.layout.filter((l) => handIds.has(l.i));
  assert(after.every((l) => l.w === 6), "Every chart should take the 2-per-row width");
  const rows = new Set(after.map((l) => l.y));
  assert(rows.size >= 2, "Four charts at two per row should span two rows");
}

/** A page with no walls at all still must not throw or claim work it did not do. */
function testReflowWithNoChartWallsDoesNothing(): void {
  const seeded = appendLinkedChartTriplet(createDefaultDashboard());
  const { dashboard: next, reflowed } = reflowWatchlistChartWalls(seeded, 2, {
    clientWidthPx: 1600,
    clientHeightPx: 900,
    suggestedRowHeight: START_HERE_RGL_ROW_HEIGHT,
  });
  assert(reflowed === 0, "Linked charts are not a watchlist wall and should not be reflowed");
  assert(next === seeded, "An untouched dashboard should be returned by identity");
}

function testClearAllWidgetsStaysEmpty(): void {
  const seeded = appendLinkedChartTriplet(createDefaultDashboard());
  const cleared = sanitizeDashboard(clearAllWidgets(seeded));
  assert(cleared.layout.length === 0, "Clear all should remove layout tiles");
  assert(Object.keys(cleared.instances).length === 0, "Clear all should remove instances");
  const roundTrip = sanitizeDashboard(cleared);
  assert(roundTrip.layout.length === 0, "Empty workspace should survive sanitize");
}

function runAll(): void {
  testSpawnChartInheritsGroupIdentity();
  testBulkLoadInheritsGroupIdentity();
  testBulkLoadSyncSkipsDuplicates();
  testBulkLoadSyncRemovesStaleAndAddsNew();
  testLinkedTripletHasColorAndSyncsSymbol();
  testViewportMetricsAdaptToWidth();
  testBulkRowMajorPlacement();
  testBulkLoadUsesViewportCells();
  testReflowWatchlistChartWallsOnDensityChange();
  testReflowSurvivesClosingTheWatchlist();
  testReflowPacksHandPlacedCharts();
  testReflowWithNoChartWallsDoesNothing();
  testClearAllWidgetsStaysEmpty();
  console.log("✅ Start Here dashboard persistence smoke tests passed");
}

runAll();

