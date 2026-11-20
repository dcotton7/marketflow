import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { archiveDelisted, ensureArchiveTables, ARCHIVE_DDL } from "./delisted-archive";

const dir = join(process.cwd(), "server/market-condition/utils");

(async () => {
  // What a delisting runs against the database, in order.
  const seen: string[] = [];
  const dialect = new PgDialect();
  const tx = { execute: async (q: any) => { seen.push(q.queryChunks ? dialect.sqlToQuery(q).sql : String(q)); return { rowCount: 1 }; } };
  await ensureArchiveTables(tx);
  await archiveDelisted(tx, "IIVI");
  const run = [...seen];
  assert.equal(run.length, ARCHIVE_DDL.length + 2, "tables ensured once, then the two copies");
  const copies = run.slice(-2);
  assert.match(copies[0], /INSERT INTO tickers_delisted .* FROM tickers t WHERE t\.symbol = \$1 AND NOT EXISTS/);
  assert.match(copies[1], /INSERT INTO ticker_slice_memberships_delisted .* FROM ticker_slice_memberships m WHERE m\.symbol = \$1 AND NOT EXISTS/);
  assert.ok(copies.every((c) => c.includes("to_jsonb(")), "the whole row is kept, whatever columns it has");
  // Running it twice: the tables are not ensured again, and each copy skips rows already kept (NOT EXISTS above).
  seen.length = 0;
  await ensureArchiveTables(tx);
  await archiveDelisted(tx, "IIVI");
  assert.equal(seen.length, 2);

  // The archive only ever grows.
  const arch = readFileSync(join(dir, "delisted-archive.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i.test(arch));

  // Every delete of a ticker or its memberships goes through the archive first, in one transaction, and the live
  // delete stays (no live read changed).
  const reg = readFileSync(join(dir, "delisted-ticker-registry.ts"), "utf8");
  const fn = reg.slice(reg.indexOf("async function deleteWithArchive"), reg.indexOf("function normalize"));
  assert.ok(fn.indexOf("db.transaction") >= 0);
  assert.ok(fn.indexOf("ensureArchiveTables(db)") >= 0 && fn.indexOf("ensureArchiveTables(db)") < fn.indexOf("db.transaction"), "tables are made outside the transaction");
  assert.ok(fn.indexOf("archiveDelisted(tx, sym)") < fn.indexOf("tx.delete(tickerSliceMemberships)"));
  assert.ok(fn.indexOf("tx.delete(tickerSliceMemberships)") < fn.indexOf("tx.delete(tickerTable)"));
  assert.ok(!/\bdb\.delete\(/.test(reg), "no delete outside the archive-first helper");
  console.log("delisted-archive tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
