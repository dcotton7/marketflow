import assert from "node:assert/strict";
import { withLivePrice, type DayBar } from "./position-rules";
import { maReclaim, openingRangeBreakout, setupHits, setupParamsFor, SETUPS, todaysBars, vwapReclaim, type FiveMinBar } from "./setup-rules";

// 2026-10-28 is EDT: 9:30 ET = 13:30Z.
const at = (i: number, dayIso = "2026-10-28") => new Date(Date.parse(`${dayIso}T13:30:00Z`) + i * 5 * 60_000).toISOString();
const five = (closes: number[], range = 0.4, volume = 1000): FiveMinBar[] =>
  closes.map((c, i) => ({ timestamp: at(i), open: i ? closes[i - 1] : c, high: c + range / 2, low: c - range / 2, close: c, volume }));
const day = (i: number) => new Date(Date.UTC(2026, 8, 1) + i * 86_400_000).toISOString().slice(0, 10);
const daily = (closes: number[], range = 2): DayBar[] =>
  closes.map((c, i) => ({ date: day(i), open: i ? closes[i - 1] : c, high: c + range / 2, low: c - range / 2, close: c, volume: 1e6 }));
const names = (hits: { name: string }[]) => hits.map((h) => h.name);

// ---- today's bars only
const yesterday = { ...five([90])[0], timestamp: at(0, "2026-10-27") };
assert.equal(todaysBars([yesterday, ...five([100, 101])], "2026-10-28").length, 2);

// ---- VWAP reclaim: dipped under VWAP, back over it now
const dip = five([101, 100, 99, 98.6, 98.8, 99.2, 99.5]);
const vr = vwapReclaim("nvda", dip, 100.6)!;
assert.equal(vr.name, "vwap_reclaim");
assert.ok(Number(vr.detail.barsBelow) >= SETUPS.vwapReclaim.belowBars, "counted the closes under VWAP");
assert.ok(Number(vr.detail.vwap) < 100.6 && Number(vr.detail.pctAbove) > 0);
assert.match(vr.message, /^nvda: back above VWAP \$\d+\.\d\d/);
assert.equal(vwapReclaim("NVDA", dip, 98.5), null, "still under VWAP");
assert.equal(vwapReclaim("NVDA", five([100, 100.5, 101, 101.5, 102, 102.5]), 103), null, "never lost VWAP: no reclaim");
assert.equal(vwapReclaim("NVDA", five([100]), 101), null, "too early");

// ---- opening range breakout: first 3 bars (15 minutes)
const orb = five([100, 100.6, 100.2, 100.4, 100.7]);
const ob = openingRangeBreakout("NVDA", orb, 101.5)!;
assert.deepEqual([ob.name, ob.detail.rangeHigh, ob.detail.rangeLow, ob.detail.minutes], ["orb_breakout", 100.8, 99.8, 15]);
assert.match(ob.message, /15-minute opening range high \$100\.80/);
assert.equal(openingRangeBreakout("NVDA", orb, 100.85), null, "under the 0.1% margin");
assert.equal(openingRangeBreakout("NVDA", orb.slice(0, 3), 102), null, "the range isn't finished yet");
assert.ok(openingRangeBreakout("NVDA", orb, 101, { bars: 2, minBreakoutPct: 0 }), "parameters are used");

// ---- MA reclaim: a 5-minute close up through the daily SMA (today's bar at the live price)
const flat = daily(Array.from({ length: 30 }, () => 100));
const under = five([99.2, 99.5, 99.7, 99.8]);
const mr = maReclaim("NVDA", withLivePrice(flat, 100.6), under, 100.6)!;
assert.equal(mr.name, "ma_reclaim");
assert.equal(mr.detail.sma, 20, "the highest SMA it crossed; 50 needs 51 days");
assert.equal(mr.detail.smaValue, 100.03);
assert.equal(maReclaim("NVDA", withLivePrice(flat, 99.9), under, 99.9), null, "still under");
assert.equal(maReclaim("NVDA", withLivePrice(flat, 101), five([100.5, 100.8, 101.2, 100.9]), 101), null, "was never under");

// ---- setupHits: the intraday checks plus Kell's entry setups, never the position-only ones
const climb = daily(Array.from({ length: 60 }, (_, i) => 70 + i), 1.5);
const extended = setupHits({ symbol: "NVDA", daily: climb, bars: five([128, 128.5, 129, 129.5]), price: 160, confirmed: false, sessionFraction: 0.5 });
assert.ok(!names(extended).includes("exhaustion_extension" as never), "Exhaustion Extension is a position alert");
const run = daily(Array.from({ length: 60 }, (_, i) => 70 + i * 0.5), 1.5);
const tight = Array.from({ length: 15 }, (_, i) => ({ ...daily([100 + (i % 3)])[0], date: day(60 + i) }));
const brk = [...run, ...tight, { date: day(75), open: 102, high: 105, low: 101, close: 104, volume: 3e6 }];
const hits = setupHits({ symbol: "NVDA", daily: brk, bars: five([101.5, 102, 102.4, 103, 103.6]), price: 105, confirmed: false, sessionFraction: 1 });
assert.ok(names(hits).includes("base_n_break"));
assert.ok(names(hits).includes("orb_breakout"));
const bnb = hits.find((h) => h.name === "base_n_break")!;
assert.equal(bnb.confirmed, false);
assert.match(bnb.message, /Base 'n Break .*still forming until the close\.$/);
assert.ok(bnb.detail.baseHigh != null && bnb.detail.relVolume != null, "records what it saw");

// ---- what a fired alert stores about its rule
assert.deepEqual(setupParamsFor("orb_breakout"), SETUPS.openingRange);
assert.equal((setupParamsFor("base_n_break") as { baseDays: number }).baseDays, 15);

console.log("setup-rules tests passed");
