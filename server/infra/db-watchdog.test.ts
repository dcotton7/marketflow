import assert from "node:assert/strict";
import { createWatchdogState, pingDatabase, watchdogMode } from "./db-watchdog";

// Five failures in a row means dead, however quickly they came.
{
  let t = 0;
  const s = createWatchdogState({ now: () => t });
  for (let i = 1; i <= 4; i++) {
    t += 1_000;
    assert.equal(s.record(false).dead, false, `fail ${i}`);
  }
  t += 1_000;
  assert.equal(s.record(false).dead, true);
}

// A good probe resets the count.
{
  let t = 0;
  const s = createWatchdogState({ now: () => t });
  for (let i = 0; i < 4; i++) s.record(false);
  s.record(true);
  for (let i = 0; i < 4; i++) assert.equal(s.record(false).dead, false);
}

// No good probe for 90s, with two failures, is dead; one slow failure alone is not.
{
  let t = 0;
  const s = createWatchdogState({ now: () => t });
  t = 95_000;
  assert.equal(s.record(false).dead, false, "one failure isn't enough");
  t = 110_000;
  const v = s.record(false);
  assert.equal(v.dead, true);
  assert.equal(v.sinceOkMs, 110_000);
}

// Mode: production exits, dev only logs, and DB_WATCHDOG wins.
assert.equal(watchdogMode({ NODE_ENV: "production" }), "exit");
assert.equal(watchdogMode({ NODE_ENV: "development" }), "log");
assert.equal(watchdogMode({ NODE_ENV: "production", DB_WATCHDOG: "off" }), "off");
assert.equal(watchdogMode({ DB_WATCHDOG: " EXIT " }), "exit");

// The ping: no pool, a hung query, an error, a good answer.
(async () => {
  assert.deepEqual((await pingDatabase(null, 50)).ok, false);
  const hung = { query: () => new Promise(() => {}) } as any;
  const r = await pingDatabase(hung, 30);
  assert.equal(r.ok, false);
  assert.match(r.error!, /no answer within 30ms/);
  const broken = { query: () => Promise.reject(new Error("timeout exceeded when trying to connect")) } as any;
  assert.match((await pingDatabase(broken, 1_000)).error!, /timeout exceeded/);
  const good = { query: () => Promise.resolve({ rows: [{ "?column?": 1 }] }) } as any;
  assert.equal((await pingDatabase(good, 1_000)).ok, true);
  console.log("db-watchdog tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
