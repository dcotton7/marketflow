/**
 * Run with: npx tsx client/src/lib/chartMeasureLabelPrefs.test.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_MEASURE_LABEL_OPACITY,
  DEFAULT_MEASURE_LABEL_SIZE_SCALE,
  clampMeasureLabelOpacity,
  clampMeasureLabelSizeScale,
  getMeasureLabelPrefs,
  measureLabelOpacityFromPercent,
  measureLabelSizeFromPercent,
  resetMeasureLabelPrefs,
  setMeasureLabelPrefs,
} from "./chartMeasureLabelPrefs";

const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size;
  },
} as Storage;

assert.equal(DEFAULT_MEASURE_LABEL_SIZE_SCALE, 0.5);
assert.equal(DEFAULT_MEASURE_LABEL_OPACITY, 0.65);
assert.equal(clampMeasureLabelSizeScale(0.1), 0.25);
assert.equal(clampMeasureLabelSizeScale(3), 1.5);
assert.equal(clampMeasureLabelOpacity(-0.2), 0);
assert.equal(clampMeasureLabelOpacity(1.4), 1);
assert.equal(measureLabelSizeFromPercent(50), 0.5);
assert.equal(measureLabelOpacityFromPercent(65), 0.65);

const unset = getMeasureLabelPrefs();
assert.equal(unset.sizeScale, 0.5);
assert.equal(unset.opacity, 0.65);

setMeasureLabelPrefs({ sizeScale: 0.8, opacity: 0.4 });
const stored = getMeasureLabelPrefs();
assert.equal(stored.sizeScale, 0.8);
assert.equal(stored.opacity, 0.4);

resetMeasureLabelPrefs();
const reset = getMeasureLabelPrefs();
assert.equal(reset.sizeScale, 0.5);
assert.equal(reset.opacity, 0.65);

console.log("chartMeasureLabelPrefs.test.ts: ok");
