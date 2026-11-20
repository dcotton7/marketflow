import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getStaleTickers, sessionsOld, splitStale, staleCutoff, STALE_SESSIONS, setStaleForTests } from "./utils/stale-guard";
import { buildClusterLeaderCandidates } from "./engine/leader-score";
import type { TickerSnapshot } from "./providers/types";

// sessions: weekdays Mon 2 Nov - Fri 20 Nov 2026
const S: string[] = [];
for (let t = Date.parse("2026-11-02T12:00:00Z"); t <= Date.parse("2026-11-20T12:00:00Z"); t += 864e5) { const wd = new Date(t).getUTCDay(); if (wd >= 1 && wd <= 5) S.push(new Date(t).toISOString().slice(0, 10)); }
const TODAY = "2026-11-20";

assert.equal(STALE_SESSIONS, 5);
assert.equal(staleCutoff(S, TODAY), "2026-11-13", "5 sessions before the latest");
assert.equal(sessionsOld(S, TODAY, "2026-11-13"), 5);
assert.equal(sessionsOld(S, TODAY, "2026-11-12"), 6);
assert.equal(sessionsOld(S, TODAY, TODAY), 0);

const snap = (symbol: string, dailyBarDate?: string, ts = "2026-11-20T15:00:00Z"): TickerSnapshot => ({
  symbol, price: 100, prevClose: 99, open: 99, high: 101, low: 98, volume: 5e6, prevDayVolume: 4e6, vwap: 100, change: 1, changePct: 1.01,
  ...(dailyBarDate ? { dailyBarDate } : {}), timestamp: new Date(ts),
});
const snaps = new Map<string, TickerSnapshot>([
  ["NVDA", snap("NVDA", TODAY)],                            // a bar today: unaffected
  ["AMD", snap("AMD", "2026-11-13")],                       // exactly 5 sessions old: still in
  ["QRVO", snap("QRVO", "2026-10-02", "2026-10-02T19:59:00Z")], // no bar since 2 October
  ["SWKS", snap("SWKS", "2026-11-12")],                     // 6 sessions old: out
  ["MU", snap("MU", undefined, "2026-10-30T19:00:00Z")],    // no daily bar date: judged by its last trade time
]);
const { fresh, stale } = splitStale(snaps, S, TODAY);
assert.deepEqual([...fresh.keys()].sort(), ["AMD", "NVDA"]);
const bySym = Object.fromEntries(stale.map((x) => [x.symbol, [x.lastBarDate, x.sessionsOld]]));
assert.deepEqual(Object.keys(bySym).sort(), ["MU", "QRVO", "SWKS"]);
assert.deepEqual(bySym.SWKS, ["2026-11-12", 6]);
assert.deepEqual(bySym.MU, ["2026-10-30", 15]);
assert.equal(bySym.QRVO[0], "2026-10-02");
assert.strictEqual(fresh.get("NVDA"), snaps.get("NVDA"), "a fresh snapshot passes through unchanged");
assert.equal(splitStale(snaps, S.slice(0, 3), TODAY).fresh, snaps, "too short a calendar: nothing is judged");

// a stale ticker is absent from leaders; a ticker with a bar today is unaffected (the real leader builder)
const spy = { symbol: "SPY", price: 700, changePct: 0.2 } as any;
const leaders = (m: Map<string, TickerSnapshot>) => buildClusterLeaderCandidates("SEMIS", m, spy).map((c) => c.symbol);
assert.equal(leaders(fresh).includes("SWKS"), false, "stale: not a leader candidate");
assert.equal(leaders(fresh).includes("NVDA"), true, "fresh: still a candidate");
assert.equal(leaders(snaps).includes("SWKS"), true, "and it was one before the guard");

// it is listed on the admin read
setStaleForTests(stale);
const list = getStaleTickers();
assert.ok(list.tickers.some((x) => x.symbol === "QRVO"));
assert.match(list.rule, /still in the universe until someone decides/);

// QRVO is retired through the delisted registry (loaded at boot: removed from SEMIS, rows archived, then deleted)
const delisted: string[] = JSON.parse(readFileSync(join(process.cwd(), "data", "delisted-symbols.json"), "utf8"));
assert.ok(delisted.includes("QRVO"));
assert.deepEqual(delisted, [...delisted].sort(), "the file stays sorted");
(async () => {
  const { applyDelistedSymbolsToClusters } = await import("./utils/delisted-ticker-registry");
  const { CLUSTERS } = await import("./universe");
  const semis = CLUSTERS.find((c) => c.id === "SEMIS")!;
  assert.ok(semis.core.includes("QRVO"), "still in the hard-coded SEMIS core list until the registry loads");
  assert.deepEqual(applyDelistedSymbolsToClusters(["QRVO"]), ["SEMIS"]);
  assert.equal(semis.core.includes("QRVO"), false, "the registry takes it out of SEMIS");
  assert.equal(buildClusterLeaderCandidates("SEMIS", snaps, spy).some((c) => c.symbol === "QRVO"), false, "so it cannot be a leader");
  console.log("stale guard tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
