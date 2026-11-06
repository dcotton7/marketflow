/**
 * Daily bars reach the alert MA / volume math oldest first.
 * Run with: npx tsx server/alerts/evaluator-daily-order.test.ts
 */
import assert from "node:assert/strict";
import { dailyBarsOldestFirst } from "./evaluator";
import { calculateSMAAtOffset } from "../shared/ma-math";

// 260 rising closes 100..359, in getDailyBars order (newest first).
const oldestFirst = Array.from({ length: 260 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  close: 100 + i,
  volume: i === 259 ? 9e6 : 1e6,
}));
const newestFirst = [...oldestFirst].reverse();

const fixed = dailyBarsOldestFirst(newestFirst)!;
const closes = fixed.map((b) => b.close);
assert.equal(calculateSMAAtOffset(closes, 10, 0), 354.5, "SMA10 today is the last 10 closes");
assert.equal(calculateSMAAtOffset(closes, 20, 1), 348.5, "SMA20 yesterday");
assert.equal(fixed[fixed.length - 1].volume, 9e6, "today's volume is the newest bar's");
assert.equal(fixed[fixed.length - 2].close, 358, "previous close is the bar before today");
assert.equal(newestFirst[0].close, 359, "the input is not mutated");

assert.deepEqual(dailyBarsOldestFirst(oldestFirst), oldestFirst, "already oldest first: unchanged");
assert.equal(dailyBarsOldestFirst(null), null);
assert.deepEqual(dailyBarsOldestFirst([]), []);
console.log("✅ evaluator daily order tests passed");
