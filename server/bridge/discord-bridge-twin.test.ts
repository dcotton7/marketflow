/**
 * Notification/channel twin matching.
 * Run with: npx tsx server/bridge/discord-bridge-twin.test.ts
 */
import assert from "node:assert/strict";
import { sameTwinText } from "./discord-bridge";

assert.equal(sameTwinText("TSLA short 431.20", "tsla  short 431.20"), true, "same text, case and spaces aside");
assert.equal(sameTwinText("TSLA short 431.20 stop 440 (half size)", "TSLA short 431.20 stop 440"), true, "a cut-off toast twins its full post");
assert.equal(sameTwinText("", "TSLA short 431.20"), false, "a chart-only post (no text) twins nothing");
assert.equal(sameTwinText("TSLA short 431.20", ""), false);
assert.equal(sameTwinText("NVDA long", "TSLA short"), false);
console.log("✅ discord twin tests passed");
