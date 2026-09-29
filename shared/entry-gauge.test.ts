import assert from "node:assert/strict";
import { formatEntryGauge, readEma620Gauge, readVwapGauge } from "./entry-gauge";

// ADR $4 on a $100 stock → 4% ADR → early band 0.60%.
const adrPct = 4;

assert.equal(readVwapGauge(100, 100.1, adrPct).tone, "entry");
assert.equal(readVwapGauge(102, 100, adrPct).tone, "safe");
assert.equal(readVwapGauge(98, 100, adrPct).tone, "fail");
assert.equal(readVwapGauge(100, 0, adrPct).tone, null);

// No ADR: fallback band is 0.25%.
assert.equal(readVwapGauge(100, 100.1, null).tone, "entry");
assert.equal(readVwapGauge(100.4, 100, null).tone, "safe");

const flatThenJump = [...Array(30).fill(100), 110];
const crossedUp = readEma620Gauge(flatThenJump, null);
assert.equal(crossedUp.cross, "up");
assert.equal(crossedUp.tone, "entry");
assert.ok(crossedUp.pct != null && crossedUp.pct > 0);

const climb = Array.from({ length: 40 }, (_, i) => 100 + i);
const held = readEma620Gauge(climb, null);
assert.equal(held.cross, null);
assert.equal(held.tone, "safe");
assert.ok(held.pct != null && held.pct > 0);

const slide = Array.from({ length: 40 }, (_, i) => 140 - i);
const under = readEma620Gauge(slide, null);
assert.equal(under.tone, "fail");
assert.ok(under.pct != null && under.pct < 0);

assert.equal(formatEntryGauge(0.08, "up"), "×+0.08");
assert.equal(formatEntryGauge(-0.4, "down"), "×−0.40");
assert.equal(formatEntryGauge(1.25, null), "+1.3");
assert.equal(formatEntryGauge(-0.08, null), "−0.08");
assert.equal(formatEntryGauge(null, null), "—");

console.log("entry-gauge.test.ts: ok");
