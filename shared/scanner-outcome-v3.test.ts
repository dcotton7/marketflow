import assert from "node:assert/strict";
import {
  classifyEvidenceTier,
  computeHorizonExcursion,
  directionAdjustedMove,
  moveFrom,
  resolveExactCheckpointClose,
  sampleConfidence,
  shrinkRate,
} from "./scanner-outcome-v3";

// ── move / direction helpers ─────────────────────────────────────────────────

assert.equal(moveFrom(110, 100).toFixed(2), "10.00");
assert.equal(directionAdjustedMove(2, "up"), 2);
assert.equal(directionAdjustedMove(2, "down"), -2);
assert.equal(directionAdjustedMove(-3, "down"), 3);

// ── exact checkpoint: prefer at-or-after, never far pre-horizon ──────────────

const signalAt = Date.UTC(2026, 8, 8, 14, 0, 0);
const bars = [
  { t: signalAt + 5 * 60_000, c: 100.1 },
  { t: signalAt + 10 * 60_000, c: 100.2 },
  { t: signalAt + 15 * 60_000, c: 101.0 },
  { t: signalAt + 20 * 60_000, c: 101.5 },
  { t: signalAt + 60 * 60_000, c: 102.0 },
];

const cp15 = resolveExactCheckpointClose(bars, signalAt + 15 * 60_000);
assert.ok(cp15);
assert.equal(cp15!.price, 101.0);

const cp14 = resolveExactCheckpointClose(bars, signalAt + 14 * 60_000);
assert.ok(cp14);
assert.equal(cp14!.price, 101.0, "should pick first bar at/after 14m target");

const tooFar = resolveExactCheckpointClose(
  [{ t: signalAt + 90 * 60_000, c: 110 }],
  signalAt + 15 * 60_000,
  25 * 60_000
);
assert.equal(tooFar, null, "bar beyond max skew should not fill checkpoint");

// ── horizon-bounded MFE/MAE ──────────────────────────────────────────────────

const excursionBars = [
  { t: signalAt + 5 * 60_000, o: 100, h: 103, l: 99.5, c: 102 },
  { t: signalAt + 15 * 60_000, o: 102, h: 104, l: 101, c: 103 },
  { t: signalAt + 30 * 60_000, o: 103, h: 103.5, l: 98, c: 99 },
];

const longExc = computeHorizonExcursion(
  excursionBars,
  signalAt,
  100,
  "up",
  30
);
assert.ok(longExc);
assert.ok(longExc!.mfe >= 4, `long MFE expected >=4, got ${longExc!.mfe}`);
assert.ok(longExc!.mae <= -1, `long MAE expected <=-1, got ${longExc!.mae}`);
assert.ok(longExc!.givebackPct > 0, "giveback should be positive after peak fade");

const shortExc = computeHorizonExcursion(
  [
    { t: signalAt + 5 * 60_000, o: 100, h: 100.5, l: 97, c: 98 },
    { t: signalAt + 20 * 60_000, o: 98, h: 101, l: 97.5, c: 100.5 },
  ],
  signalAt,
  100,
  "down",
  30
);
assert.ok(shortExc);
assert.ok(shortExc!.mfe >= 3, `short MFE expected >=3, got ${shortExc!.mfe}`);
assert.ok(shortExc!.mae <= -0.5, `short MAE expected adverse, got ${shortExc!.mae}`);

// Outside horizon bars must not inflate MFE
const bounded = computeHorizonExcursion(
  [
    { t: signalAt + 5 * 60_000, o: 100, h: 101, l: 99.5, c: 100.5 },
    { t: signalAt + 200 * 60_000, o: 100, h: 120, l: 100, c: 119 },
  ],
  signalAt,
  100,
  "up",
  15
);
assert.ok(bounded);
assert.ok(bounded!.mfe < 5, "post-horizon spike must not count toward 15m MFE");

// ── confidence / shrink / tiers ──────────────────────────────────────────────

assert.ok(shrinkRate(10, 20, 0.25, 20) > 0.3);
assert.ok(sampleConfidence(80) >= 0.99);
assert.equal(
  classifyEvidenceTier({ episodes: 5, hitRate: 0.5, edgePct: 0.4, confidence: 0.2 }),
  "unknown"
);
assert.equal(
  classifyEvidenceTier({ episodes: 60, hitRate: 0.4, edgePct: 0.2, confidence: 0.8 }),
  "strong"
);
assert.equal(
  classifyEvidenceTier({ episodes: 40, hitRate: 0.15, edgePct: -0.1, confidence: 0.7 }),
  "weak"
);

console.log("scanner-outcome-v3 tests passed");
