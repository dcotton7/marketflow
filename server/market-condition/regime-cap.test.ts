import assert from "node:assert/strict";
import { DEFAULT_DAYS, MAX_DAYS, parseDays, readRegimeHistory, regimeOf, toDaily } from "./engine/regime-history-read";
import { loadCapSizes, normalizeCapSize, resetCapSizeCacheForTests, withCapSize } from "./utils/cap-size";
import { allowedPath } from "../middleware/animaGateway";

(async () => {
  // ---- regime history: one row a day, the day's last reading, newest first ------------------------------------------
  assert.equal(parseDays(undefined), DEFAULT_DAYS);
  assert.equal(parseDays("10"), 10);
  assert.equal(parseDays("0"), DEFAULT_DAYS);
  assert.equal(parseDays("abc"), DEFAULT_DAYS);
  assert.equal(parseDays(5000), MAX_DAYS, "the window is capped");
  assert.equal(regimeOf("AGGRESSIVE"), "RISK_ON");
  assert.equal(regimeOf("DEFENSIVE"), "RISK_OFF");
  assert.equal(regimeOf("NEUTRAL"), "NEUTRAL");
  const raw = [
    { market_date: "2026-11-18", slot_at: "2026-11-18T15:00:00Z", label: "NEUTRAL", score: 52 },
    { market_date: "2026-11-18", slot_at: "2026-11-18T20:45:00Z", label: "DEFENSIVE", score: 38 },
    { market_date: "2026-11-19", slot_at: "2026-11-19T20:45:00Z", label: "DEFENSIVE", score: 35 },
    { market_date: "2026-11-19", slot_at: "2026-11-19T14:45:00Z", label: "NEUTRAL", score: 47 },
    { market_date: "2026-11-17", slot_at: "2026-11-17T20:45:00Z", label: "AGGRESSIVE", score: 71 },
  ];
  const d = toDaily(raw, 60);
  assert.deepEqual(d.map((x) => [x.date, x.raiLabel, x.regime, x.raiScore]), [
    ["2026-11-19", "DEFENSIVE", "RISK_OFF", 35],
    ["2026-11-18", "DEFENSIVE", "RISK_OFF", 38],
    ["2026-11-17", "AGGRESSIVE", "RISK_ON", 71],
  ], "the last reading of each day, whatever order the rows came in");
  assert.equal(d[0].lastReadingAt, "2026-11-19T20:45:00.000Z");
  assert.equal(toDaily(raw, 2).length, 2, "at most `days` rows");
  // "how many days since it turned risk-off": count back while RISK_OFF
  assert.equal(d.findIndex((x) => x.regime !== "RISK_OFF"), 2);
  // no table yet: an empty answer that says so, not an error
  const none = await readRegimeHistory({ execute: async () => { throw new Error('relation "regime_history" does not exist'); } }, 60);
  assert.deepEqual(none, { days: 60, rows: [], note: "no regime history stored yet" });

  // ---- capSize: the stored size bucket, null when there is none -----------------------------------------------------
  assert.equal(normalizeCapSize("mega"), "MEGA");
  assert.equal(normalizeCapSize(" Large "), "LARGE");
  assert.equal(normalizeCapSize("ALL"), null, "the filter's ALL is not a size");
  assert.equal(normalizeCapSize(null), null);
  assert.equal(normalizeCapSize("NANO"), null);
  resetCapSizeCacheForTests();
  let queries = 0;
  const db = { execute: async () => { queries++; return { rows: [{ symbol: "nvda", market_cap_size: "MEGA" }, { symbol: "CRDO", market_cap_size: "MID" }, { symbol: "ODD", market_cap_size: "huge" }] }; } };
  const sizes = await loadCapSizes(db, 1_000);
  assert.equal(sizes.get("NVDA"), "MEGA");
  assert.equal(sizes.has("ODD"), false, "an unknown bucket is not passed on");
  await loadCapSizes(db, 1_000 + 60_000);
  assert.equal(queries, 1, "cached for 10 minutes");
  const leaders = [{ symbol: "NVDA", leaderScore: 90, clusterId: "SEMIS" }, { symbol: "CRDO", leaderScore: 80, clusterId: "SEMIS" }, { symbol: "ZZZZ", leaderScore: 70, clusterId: "SEMIS" }];
  const out = withCapSize(leaders, sizes);
  assert.deepEqual(out.map((x) => x.capSize), ["MEGA", "MID", null], "no stored bucket: null, never a guess");
  assert.deepEqual(out.map(({ capSize: _c, ...rest }) => rest), leaders, "nothing else on the row changes");
  resetCapSizeCacheForTests();
  assert.equal((await loadCapSizes({ execute: async () => { throw new Error("down"); } }, 0)).size, 0, "a failed read: every capSize null");

  // ---- the gateway: the new read is open to Anima, GET only ---------------------------------------------------------
  assert.equal(allowedPath("/api/market-condition/regime/history"), true);
  assert.equal(allowedPath("/api/market-condition/regime"), true, "the old read stays open");
  assert.equal(allowedPath("/api/market-condition/regime/history", "POST"), false);
  console.log("regime history and capSize tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
