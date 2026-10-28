import assert from "node:assert/strict";
import { ALLOWED_TRANSITIONS, classifyCycle } from "./cycle";
import { computeFacts } from "./facts";
import { barsFromDrifts, indexFrom, segments } from "./testing";
import type { SubStage } from "./types";
import { weinsteinStages } from "./weinstein";

// A full cycle: base, advance, top, decline, base again.
const drifts = segments([90, 0], [70, 0.006], [25, 0.02], [40, 0], [70, -0.006], [60, 0], [70, 0.006]);
const bars = barsFromDrifts(drifts, { seed: 7, noise: 0.012 });
const index = indexFrom(barsFromDrifts(segments([bars.length, 0.0005]), { seed: 3 }));
const f = computeFacts(bars, index);
const labels = classifyCycle(f);

// Labels start once the measures exist and never jump across the cycle.
assert.equal(labels[30], null);
assert.ok(labels[80] != null);
let prev: SubStage | null = null;
for (const l of labels) {
  if (l == null) continue;
  if (prev && l !== prev) assert.ok(ALLOWED_TRANSITIONS[prev].includes(l), `illegal transition ${prev} -> ${l}`);
  prev = l;
}

const between = (a: number, b: number) => new Set(labels.slice(a, b).filter(Boolean));
assert.ok([...between(150, 185)].some((s) => s === "2A" || s === "2B" || s === "2C"), `advance should reach stage 2, got ${[...between(150, 185)]}`);
assert.ok(between(150, 190).has("2C"), "the steep leg should mark a 2C climax");
assert.ok([...between(250, 300)].some((s) => s?.startsWith("4")), `decline should reach stage 4, got ${[...between(250, 300)]}`);
assert.ok([...between(400, 425)].some((s) => s?.startsWith("2")), "the last advance should reach stage 2 again");

// Hysteresis: a single close that breaks a strong uptrend does not leave stage 2.
const spike = bars.map((b) => ({ ...b }));
const k = 160;
spike[k] = { ...spike[k], close: spike[k].close * 0.97, low: spike[k].low * 0.97 };
const spikeLabels = classifyCycle(computeFacts(spike, index));
assert.ok(spikeLabels[k]?.startsWith("2"), `one weak close should not move the label out of stage 2 (got ${spikeLabels[k]})`);

// Point in time: changing later bars never changes an earlier label.
const altered = bars.map((b, i) => (i > 300 ? { ...b, open: b.open * 0.6, high: b.high * 0.6, low: b.low * 0.6, close: b.close * 0.6 } : b));
const alteredLabels = classifyCycle(computeFacts(altered, index));
assert.deepEqual(alteredLabels.slice(0, 301), labels.slice(0, 301));

// Weinstein stage is informational and also point in time.
const w = weinsteinStages(bars);
const wAlt = weinsteinStages(altered);
assert.deepEqual(wAlt.slice(0, 296), w.slice(0, 296));
assert.ok(w.slice(150, 190).includes(2));

console.log("cycle.test.ts: ok");
