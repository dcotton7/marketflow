/**
 * Swing highs above a reference price (used by the live and the as-of-date technicals).
 * Run with: npx tsx server/sentinel/technicals-swing-highs.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findSwingHighs } from "./technicals";

// Newest first, like getDailyBars. One clear pivot high of 120 at index 5.
const highs = [100, 101, 102, 103, 104, 120, 104, 103, 102, 101, 100, 99];
const candles = highs.map((h, i) => ({
  date: new Date(Date.UTC(2026, 9, 30 - i)),
  open: h - 1,
  high: h,
  low: h - 2,
  close: h - 1,
  volume: 1000,
}));

const above = findSwingHighs(candles, 100);
assert.equal(above.length, 1, "the 120 pivot is overhead of 100");
assert.equal(above[0].price, 120);
assert.equal(above[0].daysAgo, 5);

assert.equal(findSwingHighs(candles, 130).length, 0, "nothing overhead of 130");

// The as-of-date path used to call findSwingHighs(historical) with no price, so it always came back empty.
const src = readFileSync(resolve(process.cwd(), "server/sentinel/technicals.ts"), "utf8");
assert.ok(!/findSwingHighs\(historical\)/.test(src), "every findSwingHighs call passes a reference price");

console.log("✅ technicals swing highs tests passed");
