import assert from "node:assert/strict";
import {
  FLOOD_TRACK_ONCE_PER_DAY,
  isFloodTrackOncePerDay,
  shouldClockDiscoveryEpisode,
} from "./scanner-outcome-queue";

assert.equal(FLOOD_TRACK_ONCE_PER_DAY.length, 5);
assert.equal(isFloodTrackOncePerDay("lod_bounce"), true);
assert.equal(isFloodTrackOncePerDay("ur_ma_reclaim"), false);
assert.equal(shouldClockDiscoveryEpisode("ur_ma_reclaim", 99, [10, 99]), true);
assert.equal(shouldClockDiscoveryEpisode("lod_bounce", 10, [10, 11, 12]), true);
assert.equal(shouldClockDiscoveryEpisode("lod_bounce", 12, [10, 11, 12]), false);
assert.equal(shouldClockDiscoveryEpisode("gap", 5, [5]), true);
console.log("scanner-outcome-queue.test.ts ok");
