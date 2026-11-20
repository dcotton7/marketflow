import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRenameInDb, applyRenameToClusters, applyTickerRenames, loadRenames, type Rename } from "./utils/ticker-renames";
import { buildClusterLeaderCandidates } from "./engine/leader-score";
import { CLUSTERS } from "./universe";
import type { TickerSnapshot } from "./providers/types";

(async () => {
  // ---- the decided lists ---------------------------------------------------------------------------------------
  const renames = await loadRenames(join(process.cwd(), "data", "ticker-renames.json"));
  assert.deepEqual(renames.map((r) => `${r.old}->${r.new}`), ["BK->BNY", "VSCO->VSXY", "MMC->MRSH"]);
  assert.ok(renames.every((r) => /^\d{10}$/.test(r.cik) && /^\w{9}$/.test(r.cusip) && r.evidence.includes(r.cik)), "each carries its CIK / CUSIP evidence");
  const delisted: string[] = JSON.parse(readFileSync(join(process.cwd(), "data", "delisted-symbols.json"), "utf8"));
  const retired = ["QRVO", "WBD", "BZH", "ROKU", "CRVW", "MASI", "DAY", "IPG", "AMED", "IRET", "KVUE", "AVB", "ALEX", "CTRA"];
  for (const s of [...retired, "BK", "VSCO", "MMC"]) assert.ok(delisted.includes(s), `${s} retired through the registry`);
  for (const s of ["EQR", "PSKY", "SPC", "FIVG", "BNY", "VSXY", "MRSH"]) assert.equal(delisted.includes(s), false, `${s} is not retired`);
  assert.deepEqual(delisted, [...delisted].sort());

  // ---- a rename: the new symbol takes the old one's place; the old one is no longer a leader ------------------
  const semis = CLUSTERS.find((c) => c.id === "SEMIS")!;
  const fake: Rename = { old: "SWKS", new: "SWKX", cik: "0000004127", cusip: "83088M102", evidence: "test", recordedOn: "2026-11-20" };
  const at = semis.core.indexOf("SWKS");
  assert.ok(at >= 0);
  assert.deepEqual(applyRenameToClusters(fake), ["SEMIS"]);
  assert.equal(semis.core[at], "SWKX", "same place in the list");
  assert.equal(semis.core.includes("SWKS"), false);
  const snap = (symbol: string): TickerSnapshot => ({ symbol, price: 100, prevClose: 99, open: 99, high: 101, low: 98, volume: 5e6, prevDayVolume: 4e6, vwap: 100, change: 1, changePct: 1, timestamp: new Date() });
  const snaps = new Map([["SWKS", snap("SWKS")], ["SWKX", snap("SWKX")], ["NVDA", snap("NVDA")]]);
  const leaders = buildClusterLeaderCandidates("SEMIS", snaps, { symbol: "SPY", price: 700, changePct: 0.2 } as any).map((c) => c.symbol);
  assert.equal(leaders.includes("SWKS"), false, "the old symbol no longer appears in leaders");
  assert.equal(leaders.includes("SWKX"), true, "the company does, under its new symbol");
  assert.deepEqual(applyRenameToClusters(fake), [], "applying it again changes nothing");

  // ---- the database part copies (never deletes or updates) and records the change once --------------------------
  const stmts: string[] = [];
  let recorded = false;
  const db = {
    async execute(q: any) {
      const t = JSON.stringify(q?.queryChunks ?? q ?? "");
      stmts.push(t);
      if (/information_schema.columns/.test(t)) return { rows: [{ column_name: "id" }, { column_name: "symbol" }, { column_name: "bar_date" }, { column_name: "close" }] };
      if (/SELECT 1 FROM ticker_renames/.test(t)) return { rows: recorded ? [{ "?column?": 1 }] : [] };
      if (/INSERT INTO ticker_renames/.test(t)) recorded = true;
      return { rows: [], rowCount: 2 };
    },
  };
  const r1 = await applyRenameInDb(db, fake);
  assert.equal(r1.applied, true);
  assert.equal(stmts.some((t) => /\bDELETE\b|\bUPDATE\b/i.test(t)), false, "a rename copies; it never deletes or updates");
  assert.ok(stmts.some((t) => /INSERT INTO ticker_renames/.test(t)), "a dated row records the change");
  assert.ok(stmts.findIndex((t) => /historical_bars/.test(t) && /INSERT INTO/.test(t)) < stmts.findIndex((t) => /INSERT INTO ticker_renames/.test(t)), "history first, then the record");
  assert.deepEqual(await applyRenameInDb(db, fake), { applied: false }, "once");

  // ---- a failed rename keeps its old symbol from being purged ---------------------------------------------------
  const failing = { async execute() { throw new Error("db down"); } };
  const out = await applyTickerRenames(failing, [{ ...fake, old: "AAA1", new: "AAA2" }]);
  assert.deepEqual(out.blocked, ["AAA1"]);
  assert.equal(out.safeToPurge.size, 0);
  console.log("ticker rename tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
