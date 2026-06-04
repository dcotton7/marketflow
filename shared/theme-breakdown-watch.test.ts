import {
  computeThemeBreakdownWatch,
  mergeEtfBreakdownFlags,
} from "../shared/theme-breakdown-watch";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function testBearThemeBreakdown() {
  const r = computeThemeBreakdownWatch({
    trendState: "Bear",
    pctAbove50d: 28,
    pctAbove200d: 20,
    breadthPct: 32,
    medianPct: -1.2,
    rsVsBenchmark: -0.9,
    deltaRank: -3,
    acceleration: -0.2,
    accDistDays: -4,
    bearCount: 12,
    totalCount: 20,
    rank: 26,
    totalThemes: 28,
  });
  assert(r.tier === "avoid_long" || r.tier === "breakdown_watch", "weak bear theme flags breakdown");
  assert(r.reasons.length > 0, "has reasons");
}

function testStrongThemeNone() {
  const r = computeThemeBreakdownWatch({
    trendState: "Bull",
    pctAbove50d: 72,
    pctAbove200d: 65,
    breadthPct: 68,
    medianPct: 1.5,
    rsVsBenchmark: 0.8,
    deltaRank: 2,
    acceleration: 0.1,
    rank: 3,
    totalThemes: 28,
  });
  assert(r.tier === "none", "strong theme no breakdown tier");
}

function testEtfMerge() {
  const base = computeThemeBreakdownWatch({
    trendState: "Transition",
    pctAbove50d: 48,
    breadthPct: 46,
    medianPct: -0.2,
    rsVsBenchmark: -0.1,
    deltaRank: -1,
    acceleration: 0,
    rank: 20,
    totalThemes: 28,
  });
  const merged = mergeEtfBreakdownFlags(base, {
    below50Sma: true,
    belowVwap: true,
    sessionRed: true,
  });
  assert(merged.score > base.score, "ETF flags increase score");
  assert(merged.reasons.some((x) => x.includes("VWAP")), "VWAP reason");
}

function run() {
  testBearThemeBreakdown();
  testStrongThemeNone();
  testEtfMerge();
  console.log("theme-breakdown-watch.test.ts: all passed");
}

run();
