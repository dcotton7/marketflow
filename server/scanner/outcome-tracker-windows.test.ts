/**
 * Outcome tracker windows: daily bar range and when the live price may widen peak / drawdown.
 * Run with: npx tsx server/scanner/outcome-tracker-windows.test.ts
 */
import assert from "node:assert/strict";
import { dailyBarWindow, excursionLivePrice } from "./outcome-tracker";
import { computeHorizonExcursion } from "@shared/scanner-outcome-v3";

// A fire at 09:12 ET on 2026-11-05; Alpaca stamps that day's daily bar 2026-11-05T05:00Z (midnight ET).
const signalAt = new Date("2026-11-05T14:12:00Z");
const nowMs = Date.parse("2026-11-06T15:00:00Z");
const { from, to } = dailyBarWindow(signalAt, nowMs);
assert.ok(from.getTime() <= Date.parse("2026-11-05T05:00:00Z"), "the signal day's own daily bar is inside the range");
assert.ok(to.getTime() > nowMs, "the range runs past now");

assert.equal(excursionLivePrice(30, 101), 101, "inside the 4h window the live price counts");
assert.equal(excursionLivePrice(240, 101), 101);
assert.equal(excursionLivePrice(10 * 24 * 60, 120), null, "days later it does not");

// Flat 4h of bars 99.5..100.5, then a re-process 10 days later at 120: peak stays 0.5%.
const t0 = signalAt.getTime();
const bars = Array.from({ length: 48 }, (_, i) => ({ t: t0 + i * 5 * 60_000, o: 100, h: 100.5, l: 99.5, c: 100 }));
const elapsedMin = 10 * 24 * 60;
const ex = computeHorizonExcursion(bars as any, t0, 100, "up", Math.min(240, elapsedMin), excursionLivePrice(elapsedMin, 120));
assert.ok(ex, "excursion computed");
assert.ok(Math.abs((ex as any).mfe - 0.5) < 1e-9, `peak move stays bar-bounded, got ${(ex as any).mfe}`);
console.log("✅ outcome tracker window tests passed");
