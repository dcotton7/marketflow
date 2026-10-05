import assert from "node:assert/strict";
import {
  checkPasswordWithLockout,
  createLoginLockout,
  createMemoryLockStore,
  createPgLockStore,
  isLocked,
  lockKey,
  type Query,
} from "./loginLockout";
import { createLoginRateLimiter } from "./loginRateLimit";
import { parseUnlockArgs, runUnlock, type UnlockUser } from "../scripts/unlockUser";

const DON = { id: 2, username: "donuser" };
const OTHER = { id: 3, username: "other" };
const IP = "203.0.113.9";

function setup() {
  const store = createMemoryLockStore();
  const lines: string[] = [];
  const lockout = createLoginLockout({ store, audit: (l) => lines.push(l), now: () => new Date("2026-10-05T18:00:00Z") });
  let burned = 0;
  let verified = 0;
  const attempt = (user: typeof DON | null, correct: boolean) =>
    checkPasswordWithLockout({
      lockout,
      user,
      ip: IP,
      verifyPassword: async () => {
        verified++;
        return correct;
      },
      burnTime: async () => {
        burned++;
      },
      audit: (l) => lines.push(l),
    });
  return { store, lines, attempt, counts: () => ({ burned, verified }) };
}

const tests: Array<[string, () => Promise<void>]> = [
  ["counts consecutive failures without locking before the 3rd", async () => {
    const { store, attempt } = setup();
    assert.equal(await attempt(DON, false), false);
    assert.equal(await attempt(DON, false), false);
    const s = await store.get(DON.id);
    assert.equal(s?.failedCount, 2);
    assert.equal(isLocked(s), false);
  }],
  ["locks on the 3rd failure", async () => {
    const { store, attempt, lines } = setup();
    for (let i = 0; i < 3; i++) assert.equal(await attempt(DON, false), false);
    assert.equal(isLocked(await store.get(DON.id)), true);
    assert.ok(lines.some((l) => l.includes("LOCKED after 3")));
  }],
  ["success before the 3rd failure resets the count", async () => {
    const { store, attempt } = setup();
    await attempt(DON, false);
    await attempt(DON, false);
    assert.equal(await attempt(DON, true), true);
    assert.equal(await store.get(DON.id), null);
    await attempt(DON, false);
    await attempt(DON, false);
    assert.equal(isLocked(await store.get(DON.id)), false, "count restarted from 0");
  }],
  ["locked account refuses the correct password without checking it", async () => {
    const { attempt, counts, store } = setup();
    for (let i = 0; i < 3; i++) await attempt(DON, false);
    const before = counts();
    assert.equal(await attempt(DON, true), false);
    assert.equal(counts().verified, before.verified, "password not compared");
    assert.equal(counts().burned, before.burned + 1, "same bcrypt cost as a real check");
    assert.equal(isLocked(await store.get(DON.id)), true, "still locked");
  }],
  ["locks are per account", async () => {
    const { store, attempt } = setup();
    for (let i = 0; i < 3; i++) await attempt(OTHER, false);
    assert.equal(await attempt(DON, true), true);
    assert.equal(isLocked(await store.get(OTHER.id)), true);
  }],
  ["unknown username creates no record", async () => {
    const { store, attempt, counts, lines } = setup();
    for (let i = 0; i < 5; i++) assert.equal(await attempt(null, false), false);
    assert.equal(store.rows.size, 0);
    assert.equal(counts().burned, 5);
    assert.ok(lines.every((l) => !l.includes("donuser")));
  }],
  ["concurrent guesses cannot exceed the budget", async () => {
    const { store, counts, attempt } = setup();
    const results = await Promise.all(Array.from({ length: 8 }, () => attempt(DON, false)));
    assert.ok(results.every((r) => r === false));
    assert.ok(counts().verified <= 3, `verified=${counts().verified}`);
    assert.equal(isLocked(await store.get(DON.id)), true);
  }],
  ["audit lines never contain the password or the full username", async () => {
    const { lines, attempt } = setup();
    for (let i = 0; i < 4; i++) await attempt(DON, false);
    assert.ok(lines.length >= 4);
    assert.ok(lines.every((l) => !l.includes("donuser") && l.includes("d***")));
  }],
  ["pg store sends the expected key and parses payloads", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const query: Query = async (text, params) => {
      calls.push({ text, params });
      if (text.startsWith("SELECT config_key")) {
        return { rows: [{ config_key: "login_lock:user:2", payload: { failedCount: 3, lockedAt: "t", lastFailAt: "t" } }] };
      }
      if (text.startsWith("SELECT payload")) return { rows: [{ payload: { failedCount: 1, lockedAt: null, lastFailAt: null } }] };
      if (text.startsWith("DELETE")) return { rows: [], rowCount: 1 };
      return { rows: [{ payload: { failedCount: 2, lockedAt: null, lastFailAt: "x" } }] };
    };
    const store = createPgLockStore(query);
    assert.deepEqual(await store.reserve(2, 3, "now"), { failedCount: 2, lockedAt: null, lastFailAt: "x" });
    assert.equal(calls[0].params?.[0], lockKey(2));
    assert.match(calls[0].text, /sentinel_tier_access_overrides/);
    assert.deepEqual((await store.list()).map((r) => r.userId), [2]);
    assert.equal(await store.clear(2), true);
    assert.ok(calls.every((c) => !/sentinel_users/.test(c.text)), "never writes sentinel_users");
  }],
  ["IP throttle blocks after 10 failures and expires after the window", async () => {
    let t = 0;
    const rl = createLoginRateLimiter({ now: () => t });
    for (let i = 0; i < 9; i++) rl.recordFailure("1.2.3.4");
    assert.equal(rl.isLimited("1.2.3.4"), false);
    rl.recordFailure("1.2.3.4");
    assert.equal(rl.isLimited("1.2.3.4"), true);
    assert.equal(rl.isLimited("5.6.7.8"), false, "per IP");
    t += 15 * 60 * 1000 + 1;
    assert.equal(rl.isLimited("1.2.3.4"), false, "auto-expires");
    rl.recordFailure("5.6.7.8");
    rl.clear("5.6.7.8");
    assert.equal(rl.isLimited("5.6.7.8"), false);
  }],
  ["unlock script: dry run by default, --apply clears, status lists", async () => {
    const store = createMemoryLockStore();
    for (let i = 0; i < 3; i++) await store.reserve(OTHER.id, 3, "t");
    await store.fail(OTHER.id, 3, "t");
    const users: UnlockUser[] = [{ id: 3, username: "other", isActive: false }];
    const out: string[] = [];
    const deps = {
      store,
      findUserById: async (id: number) => users.find((u) => u.id === id) ?? null,
      findUserByUsername: async (n: string) => users.find((u) => u.username === n) ?? null,
      log: (l: string) => out.push(l),
    };
    assert.equal(await runUnlock(parseUnlockArgs(["--status"]), deps), 0);
    assert.ok(out.some((l) => l.includes("id=3") && l.includes("LOCKED") && l.includes("o***")));
    assert.ok(out.every((l) => !l.includes("other ")));

    assert.equal(await runUnlock(parseUnlockArgs(["--username=other"]), deps), 0);
    assert.equal(isLocked(await store.get(3)), true, "dry run changes nothing");

    assert.equal(await runUnlock(parseUnlockArgs(["--id=3", "--apply"]), deps), 0);
    assert.equal(await store.get(3), null);

    assert.equal(await runUnlock(parseUnlockArgs(["--id=99"]), deps), 1);
    assert.equal(await runUnlock(parseUnlockArgs([]), deps), 2);
    assert.throws(() => parseUnlockArgs(["--id=abc"]));
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`);
  }
}
console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
