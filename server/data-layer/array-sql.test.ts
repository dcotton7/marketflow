/**
 * Fixed cases: how a JS array inside a drizzle query reaches Postgres. No database: each query is serialised with
 * drizzle's own PgDialect (the step db.execute and the query builder both run before sending) and the SQL text and
 * params are checked. drizzle turns an array inside sql`...` into a parenthesised list, one placeholder per item, so
 * sql`x = ANY(${list})` is sent as `x = ANY(($1, $2))` and Postgres refuses it ("op ANY/ALL (array) requires array on
 * right side"). The fakes elsewhere never build SQL, which is how ten of these reached the live database (1f01764).
 */
import assert from "node:assert/strict";
import pg from "pg";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { historicalBars } from "@shared/schema";
import { batchBarsWhere } from "./daily-bars";
import { pgEarningsSource } from "../gateway-reads/earnings";
import { pgHistorySource } from "../gateway-reads/theme-history";
import { pgTriggerStore } from "../trigger-scanner/store";

const dialect = new PgDialect();
const ser = (q: any) => dialect.sqlToQuery(q);

/** a db whose execute only records the serialised query */
function capturingDb() {
  const seen: { sql: string; params: unknown[] }[] = [];
  return { seen, db: { async execute(q: any) { seen.push(ser(q)); return { rows: [] }; } } };
}
/** no `ANY((` / `ALL((`: an ANY over a parenthesised list is what Postgres refuses */
function assertNoListInAny(q: { sql: string }, what: string) {
  assert.ok(!/\b(ANY|ALL)\s*\(\s*\(/i.test(q.sql), `${what}: ANY over a value list: ${q.sql}`);
}
/** the list is sent as `IN ($a, $b, ...)` with each value its own param */
function assertInList(q: { sql: string; params: unknown[] }, values: unknown[], what: string) {
  const ph = values.map(() => "\\$\\d+").join(", ");
  assert.ok(new RegExp(`\\bin \\(${ph}\\)`, "i").test(q.sql), `${what}: no IN list of ${values.length}: ${q.sql}`);
  for (const v of values) assert.ok(q.params.includes(v), `${what}: ${String(v)} not a param`);
}

// 1. the old form, as drizzle 0.39 sends it: the reason the live queries failed
{
  const old = ser(sql`${historicalBars.symbol} = ANY(${["AAPL", "MSFT"]})`);
  assert.equal(old.sql, `"historical_bars"."symbol" = ANY(($1, $2))`);
  assert.deepEqual(old.params, ["AAPL", "MSFT"]);
}

// 2. data-layer/daily-bars.ts getDailyBarsBatch, built by the query builder exactly as the function builds it
{
  const db = drizzle(new pg.Pool()); // never connects: toSQL only serialises
  const q = db.select().from(historicalBars).where(batchBarsWhere(["AAPL", "MSFT", "NVDA"], "2026-01-01")).toSQL();
  assertNoListInAny(q, "daily bars batch");
  assert.match(q.sql, /where \("historical_bars"\."symbol" in \(\$1, \$2, \$3\) and "historical_bars"\."bar_date" >= \$4\)/);
  assert.deepEqual(q.params, ["AAPL", "MSFT", "NVDA", "2026-01-01"]);
  // one symbol stays a list of one, not a bare text param
  const one = db.select().from(historicalBars).where(batchBarsWhere(["AAPL"], "2026-01-01")).toSQL();
  assert.match(one.sql, /"symbol" in \(\$1\)/);
  // an empty list is a plain false, not `in ()` (the function also returns early on an empty list)
  const none = db.select().from(historicalBars).where(batchBarsWhere([], "2026-01-01")).toSQL();
  assert.match(none.sql, /where \(false and /);
}

// 3. the forms fixed in 1f01764, through their real Postgres sources with a capturing db
{
  const syms = ["NVDA", "CRM"];
  const { seen, db } = capturingDb();
  const src = pgEarningsSource(db);
  await src.calendarFor("2026-11-25", syms, "2026-11-26");
  await src.tickerDates(syms);
  await src.followed(syms);
  const lists = seen.filter((q) => /symbol in \(/i.test(q.sql));
  assert.ok(lists.length >= 3, `earnings: expected the list reads, saw ${seen.map((q) => q.sql).join(" | ")}`);
  for (const q of seen) assertNoListInAny(q, "earnings");
  for (const q of lists) assertInList(q, syms, "earnings");
}
{
  const { seen, db } = capturingDb();
  await pgHistorySource(db).closes(["NVDA", "CRM"], ["2026-11-24", "2026-11-25"]);
  assert.equal(seen.length, 1);
  assertNoListInAny(seen[0], "theme closes");
  assertInList(seen[0], ["NVDA", "CRM"], "theme closes symbols");
  assertInList(seen[0], ["2026-11-24", "2026-11-25"], "theme closes dates");
  const empty = capturingDb();
  await pgHistorySource(empty.db).closes([], ["2026-11-25"]);
  assert.equal(empty.seen.length, 0, "no symbols: no query");
}
{
  const { seen, db } = capturingDb();
  const store = pgTriggerStore(db);
  await store.listCandidates({ day: "2026-11-26", since: 0, grades: ["A", "B"], viewerUserId: 7, side: null, setup: null, limit: 50 } as any);
  const q = seen.find((x) => /FROM trigger_candidates/.test(x.sql))!;
  assert.ok(q, "list query sent");
  assertNoListInAny(q, "trigger list");
  assertInList(q, ["A", "B"], "trigger list grades");
  const empty = capturingDb();
  assert.deepEqual(await pgTriggerStore(empty.db).listCandidates({ day: "2026-11-26", since: 0, grades: [], viewerUserId: null, side: null, setup: null, limit: 50 } as any), []);
  assert.ok(!empty.seen.some((x) => /FROM trigger_candidates/.test(x.sql)), "no grades: no list query");
}

// 4. no drizzle template left in server/ that puts a value inside ANY( / ALL(
{
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p); continue; }
      if (!/\.ts$/.test(f) || /\.test\.ts$/.test(f)) continue;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (/\b(ANY|ALL)\s*\(\s*\$\{/i.test(line)) hits.push(`${p}:${i + 1}`); });
    }
  };
  walk(new URL("..", import.meta.url).pathname);
  assert.deepEqual(hits, [], "a drizzle sql`` template sends an array to ANY/ALL as a value list; use inArray or IN (sql.join)");
}

console.log("array-sql: ok");
process.exit(0);
