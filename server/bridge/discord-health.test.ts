/**
 * Discord room health (GET /api/health/discord) and the "an empty summary is never the room's summary" rule.
 * Run with: npx tsx server/bridge/discord-health.test.ts
 */
import assert from "node:assert/strict";
import { discordHealth, isUsMarketHours, keepSummary } from "./discord-health";

// Mon 9 Nov 2026, 9:35 ET (14:35Z, EST)
const now = Date.parse("2026-11-09T14:35:00Z");
assert.equal(isUsMarketHours(new Date(now)), true);
assert.equal(isUsMarketHours(new Date("2026-11-09T14:29:00Z")), false, "9:29 ET is before the open");
assert.equal(isUsMarketHours(new Date("2026-11-07T15:00:00Z")), false, "Saturday");
assert.equal(isUsMarketHours(new Date("2026-11-26T15:00:00Z")), false, "Thanksgiving");

const busy = Array.from({ length: 78 }, (_, i) => ({ ts: now - i * 10_000 }));

// What Don saw: 78 messages in 15 minutes, and a summary from 3 minutes ago that read none.
const seen = discordHealth({
  source: "relay", status: { running: true, relayStale: false }, messages: busy, now,
  summary: { generatedAt: new Date(now - 3 * 60_000).toISOString(), messageCount: 0, minutes: 60 },
});
assert.equal(seen.ok, false);
assert.deepEqual(seen.problems, ["summary_empty_but_room_active"]);
assert.equal(seen.messages15m, 78);
assert.equal(seen.summary?.ageMin, 3);

const fine = discordHealth({ source: "relay", status: { running: true, relayStale: false }, messages: busy, now,
  summary: { generatedAt: new Date(now).toISOString(), messageCount: 78, minutes: 60 } });
assert.equal(fine.ok, true, JSON.stringify(fine.problems));

const quiet = discordHealth({ source: "relay", status: { running: true, relayStale: true },
  messages: [{ ts: now - 25 * 60_000 }], now });
assert.deepEqual(quiet.problems, ["relay_stale", "no_new_messages_20m"]);
assert.equal(quiet.lastMessageAgeMin, 25);

const stopped = discordHealth({ source: "local", status: { running: false }, messages: busy, now });
assert.deepEqual(stopped.problems, ["capture_stopped"]);
assert.equal(stopped.relayStale, null, "LOCAL has no relay");

const night = discordHealth({ source: "relay", status: { running: false, relayStale: true }, messages: [],
  now: Date.parse("2026-11-10T03:00:00Z") });
assert.equal(night.ok, true, "after hours a quiet or stopped capture isn't a problem");
assert.deepEqual(discordHealth({ source: "none", messages: [], now }).problems, ["no_source"]);

const json = JSON.stringify(seen);
assert.ok(!/text|author|symbol|ticker/i.test(json), "public: counts and ages only");

assert.equal(keepSummary({ messageCount: 0 }), null);
assert.deepEqual(keepSummary({ messageCount: 3 }), { messageCount: 3 });
assert.equal(keepSummary(null), null);
console.log("✅ discord health tests passed");
