/**
 * Run with: npx tsx client/src/lib/chartMeasureLabelPrefs.test.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_MEASURE_LABEL_BG_DOWN,
  DEFAULT_MEASURE_LABEL_BG_UP,
  DEFAULT_MEASURE_LABEL_OPACITY,
  DEFAULT_MEASURE_LABEL_SIZE_SCALE,
  DEFAULT_MEASURE_LABEL_TEXT_DOWN,
  DEFAULT_MEASURE_LABEL_TEXT_UP,
  clampMeasureLabelOpacity,
  clampMeasureLabelSizeScale,
  getMeasureLabelPrefs,
  measureLabelHexToRgba,
  measureLabelOpacityFromPercent,
  measureLabelSizeFromPercent,
  resetMeasureLabelPrefs,
  resolveMeasureLabelHex,
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
assert.equal(DEFAULT_MEASURE_LABEL_TEXT_UP, "#ffffff");
assert.equal(DEFAULT_MEASURE_LABEL_TEXT_DOWN, "#ffffff");
assert.equal(DEFAULT_MEASURE_LABEL_BG_UP, "#22c55e");
assert.equal(DEFAULT_MEASURE_LABEL_BG_DOWN, "#ef4444");
assert.equal(clampMeasureLabelSizeScale(0.1), 0.25);
assert.equal(clampMeasureLabelSizeScale(3), 1.5);
assert.equal(clampMeasureLabelOpacity(-0.2), 0);
assert.equal(clampMeasureLabelOpacity(1.4), 1);
assert.equal(measureLabelSizeFromPercent(50), 0.5);
assert.equal(measureLabelOpacityFromPercent(65), 0.65);
assert.equal(resolveMeasureLabelHex("#0f0", "#ffffff"), "#00ff00");
assert.equal(measureLabelHexToRgba("#22c55e", 0.65, "#22c55e"), "rgba(34, 197, 94, 0.65)");

const unset = getMeasureLabelPrefs();
assert.equal(unset.sizeScale, 0.5);
assert.equal(unset.opacity, 0.65);
assert.equal(unset.textUp, "#ffffff");
assert.equal(unset.bgDown, "#ef4444");

setMeasureLabelPrefs({ sizeScale: 0.8, opacity: 0.4, textUp: "#111111", bgUp: "#00aa00" });
const stored = getMeasureLabelPrefs();
assert.equal(stored.sizeScale, 0.8);
assert.equal(stored.opacity, 0.4);
assert.equal(stored.textUp, "#111111");
assert.equal(stored.bgUp, "#00aa00");
assert.equal(stored.textDown, "#ffffff");
assert.equal(stored.bgDown, "#ef4444");

resetMeasureLabelPrefs();
const reset = getMeasureLabelPrefs();
assert.equal(reset.sizeScale, 0.5);
assert.equal(reset.bgUp, "#22c55e");

console.log("chartMeasureLabelPrefs.test.ts: ok");
