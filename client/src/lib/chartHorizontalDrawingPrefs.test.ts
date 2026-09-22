/**
 * Run with: npx tsx client/src/lib/chartHorizontalDrawingPrefs.test.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_HORIZONTAL_DRAWING_COLOR, resolveHorizontalDrawingHex } from "./chartHorizontalDrawingPrefs";

assert.equal(DEFAULT_HORIZONTAL_DRAWING_COLOR, "#ffffff");
assert.equal(resolveHorizontalDrawingHex(undefined), "#ffffff");
assert.equal(resolveHorizontalDrawingHex("not-a-color"), "#ffffff");
assert.equal(resolveHorizontalDrawingHex("#0f0"), "#00ff00");

console.log("chartHorizontalDrawingPrefs.test.ts: ok");
