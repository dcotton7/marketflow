import assert from "node:assert/strict";
import { V1_SPEC, type MarketLeadersSpec } from "./spec";
import { finalizeDay, scoreSymbol, walkBook, type LeaderBar } from "./rank";

function iso(index: number): string {
  const date = new Date(Date.UTC(2020, 0, 1));
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function series(count: number, closeAt: (index: number) => number, volume = 2_000_000): LeaderBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = closeAt(index);
    return {
      date: iso(index),
      open: close * 0.99,
      high: close * 1.01,
      low: close * 0.98,
      close,
      volume,
    };
  });
}

const tiny: MarketLeadersSpec = {
  ...V1_SPEC,
  joinScore: 50,
  stayScore: 40,
  atRiskScore: 45,
  lookback: 30,
  smaFast: 5,
  smaSlow: 15,
  slopeBars: 3,
  minDollarVolume: 1_000_000,
  minClose: 5,
  lowExtension: 1.1,
  udvrBars: 10,
  gapWindow: 10,
  rsLineWindow: 3,
};

const leader = series(260, (index) => 40 * 1.012 ** index);
const laggard = series(260, () => 100);
const spy = series(260, (index) => 100 * 1.001 ** index);
const spyMap = new Map(spy.map((bar) => [bar.date, bar.close]));
const end = leader.length - 1;

const leaderRaw = scoreSymbol("LEAD", leader, end, spyMap, 0.1, "Semis", V1_SPEC);
const laggardRaw = scoreSymbol("FLAT", laggard, end, spyMap, 0.8, "Staples", V1_SPEC);
assert.ok(leaderRaw && laggardRaw);
assert.equal(leaderRaw.passed, true, "rising leader passes every gate");
assert.equal(laggardRaw.gates.find((gate) => gate.id === "g5")?.pass, false);

const [scoredLeader, scoredLaggard] = finalizeDay([leaderRaw, laggardRaw], new Set(["LEAD", "FLAT"]), V1_SPEC);
assert.ok(scoredLeader.score >= 75, `leader score ${scoredLeader.score}`);
assert.equal(scoredLeader.points.find((line) => line.key === "rs")?.points, 25);
assert.equal(scoredLeader.points.find((line) => line.key === "fundamentals")?.points, 0);
assert.ok((scoredLaggard.rsPercentile ?? 100) < (scoredLeader.rsPercentile ?? 0));

const shortBars = series(40, (index) => 50 + index);
const short = scoreSymbol("SHORT", shortBars, shortBars.length - 1, spyMap, null, null, V1_SPEC);
assert.ok(short);
assert.equal(short.gates.find((gate) => gate.id === "g4")?.pass, false);
assert.equal(short.gates.find((gate) => gate.id === "g5")?.pass, false);

const climb = series(70, (index) => 20 * 1.03 ** index, 1_000_000);
const climbSpy = new Map(series(70, (index) => 50 * 1.001 ** index).map((bar) => [bar.date, bar.close]));
const broke = climb.map((bar, index) =>
  index < 66 ? bar : { ...bar, close: bar.close * 0.5, open: bar.open * 0.5, high: bar.high * 0.5, low: bar.low * 0.5 },
);
const days = [62, 63, 64, 65, 66, 67, 68].map((index) => {
  const raw = scoreSymbol("CLIMB", index < 66 ? climb : broke, index, climbSpy, 0.1, "Semis", tiny);
  assert.ok(raw);
  const [scored] = finalizeDay([raw], new Set(["CLIMB"]), tiny);
  return { date: climb[index].date, scores: [scored] };
});
const walked = walkBook(days, tiny, null, days[days.length - 1].date);
assert.equal(walked.rows.length, 0, "three failed closes remove the name");
assert.equal(walked.left.length, 1);
assert.match(walked.left[0].leaveReason ?? "", /Gate failed 3 closes/);

const stillOn = walkBook(days.slice(0, 4), tiny, null, days[3].date);
assert.equal(stillOn.rows.length, 1);
assert.equal(stillOn.rows[0].status === "left", false);

console.log("market-leaders rank.test.ts ok");
