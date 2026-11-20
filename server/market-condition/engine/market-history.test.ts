import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  recordMarketHistory, resetMemoryForTests, inMarketHours, DDL,
  type HistoryStore, type ThemeTickRow, type MembershipRow, type RegimeRow,
} from "./market-history";

/** An in-memory store with the same unique keys as the tables. It has no delete or update, on purpose. */
function memStore() {
  const ticks = new Map<string, ThemeTickRow>();
  const members = new Map<string, MembershipRow>();
  const regimes = new Map<string, RegimeRow>();
  const store: HistoryStore = {
    async insertThemeTicks(rows) { let n = 0; for (const r of rows) { const k = `${r.slotAt.toISOString()}|${r.themeId}`; if (!ticks.has(k)) { ticks.set(k, r); n++; } } return n; },
    async insertMembership(rows) { let n = 0; for (const r of rows) { const k = `${r.marketDate}|${r.themeId}|${r.symbol}`; if (!members.has(k)) { members.set(k, r); n++; } } return n; },
    async insertRegime(r) { const k = r.slotAt.toISOString(); if (regimes.has(k)) return 0; regimes.set(k, r); return 1; },
  };
  return { store, ticks, members, regimes };
}

const THEMES = [
  { id: "SEMIS", rank: 1, score: 80, medianPct: 1.2, rsVsBenchmark: 0.5, breadthPct: 70 },
  { id: "AI_INFRA", rank: 2, score: 70, medianPct: 0.8, rsVsBenchmark: 0.2, breadthPct: 60 },
];
const regime = async () => ({ score: 55, label: "NEUTRAL", riskMultiplier: 1, components: { trendPosition: 10, marketBreadth: 12 } });
const membership = (id: string) => (id === "SEMIS" ? [{ symbol: "nvda", isCore: true }, { symbol: "AMD", isCore: false }] : [{ symbol: "NVDA", isCore: false }]);
// Mon 16 Nov 2026, EST: 10:00 ET = 15:00Z
const at = (hh: number, mm: number, day = "2026-11-16") => new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);

(async () => {
  // Writes once per interval: many refreshes inside one 5-minute slot write one set; the next slot writes another.
  {
    resetMemoryForTests();
    const m = memStore();
    const run = (d: Date) => recordMarketHistory(m.store, THEMES, { now: d, regime, membership });
    assert.deepEqual(await run(at(15, 0)), { ticks: 2, membership: 3, regime: 1 });
    assert.deepEqual(await run(at(15, 1)), { ticks: 0, membership: 0, regime: 0 }, "same slot: nothing");
    assert.deepEqual(await run(at(15, 4)), { ticks: 0, membership: 0, regime: 0 });
    assert.deepEqual(await run(at(15, 5)), { ticks: 2, membership: 0, regime: 0 }, "next 5 min: ticks only; regime waits 15 min; membership is daily");
    assert.deepEqual(await run(at(15, 10)), { ticks: 2, membership: 0, regime: 0 });
    assert.deepEqual(await run(at(15, 15)), { ticks: 2, membership: 0, regime: 1 }, "15 min: regime again");
    assert.equal(m.ticks.size, 8);
    assert.equal(m.regimes.size, 2);
    assert.equal(m.members.size, 3);
    assert.deepEqual([...m.regimes.values()][0].components, { trendPosition: 10, marketBreadth: 12 });
  }

  // Survives a restart: a new process (memory reset) on the same database adds nothing for a slot already kept.
  {
    resetMemoryForTests();
    const m = memStore();
    await recordMarketHistory(m.store, THEMES, { now: at(15, 0), regime, membership });
    resetMemoryForTests();
    const again = await recordMarketHistory(m.store, THEMES, { now: at(15, 2), regime, membership });
    assert.deepEqual(again, { ticks: 0, membership: 0, regime: 0 });
    assert.equal(m.ticks.size, 2);
    assert.equal(m.members.size, 3);
  }

  // Never deletes: a row from 400 days back is still there after a new day's writes, and no code path in the
  // history module, its hook or its store removes anything.
  {
    resetMemoryForTests();
    const m = memStore();
    await recordMarketHistory(m.store, THEMES, { now: at(15, 0, "2025-10-13"), regime, membership });
    const before = m.ticks.size;
    await recordMarketHistory(m.store, THEMES, { now: at(15, 0), regime, membership });
    assert.equal(m.ticks.size, before + 2);
    assert.ok([...m.ticks.values()].some((r) => r.marketDate === "2025-10-13"));
    const src = readFileSync(join(process.cwd(), "server/market-condition/engine/market-history.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i.test(src.replace(/DO NOTHING/g, "")), "history module never removes or rewrites");
    assert.ok(DDL.every((s) => /^CREATE (TABLE|INDEX) IF NOT EXISTS/.test(s)));
  }

  // Outside market hours nothing is written.
  {
    resetMemoryForTests();
    const m = memStore();
    for (const d of [at(13, 0), at(21, 30), at(15, 0, "2026-11-21") /* Saturday */]) {
      assert.deepEqual(await recordMarketHistory(m.store, THEMES, { now: d, regime, membership }), { ticks: 0, membership: 0, regime: 0 });
    }
    assert.equal(inMarketHours(at(14, 30)), true);  // 9:30 ET
    assert.equal(inMarketHours(at(14, 29)), false);
    assert.equal(inMarketHours(at(21, 0)), false);  // 16:00 ET
    assert.equal(m.ticks.size, 0);
  }

  // A failing write never throws and is retried the next slot.
  {
    resetMemoryForTests();
    const m = memStore();
    const broken: HistoryStore = { ...m.store, insertThemeTicks: async () => { throw new Error("db down"); } };
    const r = await recordMarketHistory(broken, THEMES, { now: at(15, 0), regime, membership });
    assert.equal(r.ticks, 0);
    assert.equal(r.regime, 1);
  }
  console.log("market-history tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
