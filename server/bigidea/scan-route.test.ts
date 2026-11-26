/**
 * POST /api/bigidea/scan end to end on a scratch Postgres (route-harness.ts) with made-up daily bars in
 * historical_bars: the optimizer never changes which names pass (OR and linked ideas), and FND-4 Earnings Proximity
 * passes on the stored earnings dates. No vendor call is needed: daily bars and earnings come from our own tables.
 */
import assert from "node:assert/strict";
import { startHarness } from "./route-harness";
import { etDateKey } from "@shared/us-market-holidays";

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/** `closes` newest first, one weekday per bar ending today-ish. */
function rows(symbol: string, closesNewestFirst: number[]) {
  const out: any[] = [];
  let d = etDateKey();
  for (const c of closesNewestFirst) {
    while ([0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())) d = addDays(d, -1);
    out.push([symbol, d, c, c + 0.5, c - 0.5, c, 1_000_000]);
    d = addDays(d, -1);
  }
  return out;
}
const p = (name: string, value: any) => ({ name, label: name, type: typeof value === "number" ? "number" : "select", value });
const runUp = { indicatorId: "PA-18", label: "run-up", inverted: false, params: [p("startBar", 10), p("period", 5), p("changeType", "gain"), p("minChangePct", 5), p("maxChangePct", 100)] };
const never20 = { indicatorId: "PA-18", label: "20% run", inverted: false, params: [p("startBar", 10), p("period", 5), p("changeType", "gain"), p("minChangePct", 20), p("maxChangePct", 100)] };
// skipBars with the canvas's param auto-link switched off (autoLinked: false): see test 5 for what it does when on
const noLink = { ...p("skipBars", 0), autoLinked: false };
const aboveSma5 = { indicatorId: "MA-1", label: "above 5", inverted: false, params: [noLink, p("period", 5), p("direction", "above")] };
const belowSma5 = { indicatorId: "MA-1", label: "below 5", inverted: false, params: [noLink, p("period", 5), p("direction", "below")] };
const thought = (id: string, crit: any) => ({ id, type: "thought", thoughtName: id, thoughtTimeframe: "daily", thoughtCriteria: [crit], position: { x: 0, y: 0 } });
const results = { id: "results", type: "results", position: { x: 1, y: 0 } };

async function main() {
  const h = await startHarness();
  if (!h) return;
  const { call, users, sql } = h;
  try {
    const sym = `ZQ${Date.now() % 100000}`;
    const [A, B, C] = [`${sym}A`, `${sym}B`, `${sym}C`];
    // rises from 100 (bar 10) to 110 (bar 5), then falls to 95 today: below its 5 SMA today, above it at bar 5
    const shape = [95, 97, 99, 101, 104, 110, 108, 106, 104, 102, 100, ...Array(80).fill(100)];
    const all = [...rows(A, shape), ...rows(B, shape), ...rows(C, shape), ...rows("SPY", Array(91).fill(400))];
    for (const r of all) {
      await sql(`INSERT INTO historical_bars (symbol, bar_date, open, high, low, close, volume) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`, r);
    }
    const scan = async (nodes: any[], edges: any[], env: Record<string, string> = {}) => {
      Object.assign(process.env, env);
      const r = await call("POST", "/api/bigidea/scan", users.owner, { nodes, edges, customTickers: [A, B, C] });
      for (const k of Object.keys(env)) delete process.env[k];
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
      return r.body;
    };

    // 1. A OR B where every name passes only B
    const or = await scan([thought("a", never20), thought("b", belowSma5), results],
      [{ id: "e1", source: "a", target: "results", logicType: "OR" }, { id: "e2", source: "b", target: "results", logicType: "OR" }]);
    assert.deepEqual(or.results.map((x: any) => x.symbol).sort(), [A, B, C], "A OR B keeps names that pass only B");

    // 2. two independent thoughts both AND into Results: B judged today (fails); linked A -> B: judged at A's end (passes)
    const star = await scan([thought("a", runUp), thought("b", aboveSma5), results],
      [{ id: "e1", source: "a", target: "results", logicType: "AND" }, { id: "e2", source: "b", target: "results", logicType: "AND" }]);
    assert.equal(star.results.length, 0, "unlinked thoughts are not time-linked by the optimizer");
    const linked = await scan([thought("a", runUp), thought("b", aboveSma5), results],
      [{ id: "e1", source: "a", target: "b", logicType: "AND" }, { id: "e2", source: "b", target: "results", logicType: "AND" }]);
    assert.equal(linked.results.length, 3, "linked: B is evaluated where A's pattern ended");

    // 3. pure AND: the same answer with the optimizer on and off
    const nodes = [thought("a", runUp), thought("b", belowSma5), results];
    const edges = [{ id: "e1", source: "a", target: "results", logicType: "AND" }, { id: "e2", source: "b", target: "results", logicType: "AND" }];
    const on = await scan(nodes, edges);
    const off = await scan(nodes, edges, { BIGIDEA_QUERY_OPTIMIZER: "off" });
    assert.deepEqual(on.results.map((x: any) => x.symbol).sort(), off.results.map((x: any) => x.symbol).sort());
    assert.equal(on.results.length, 3);

    // 5. the canvas's param auto-link (a separate, visible feature, left as it is): with it on, a skipBars param takes
    //    another thought's sequenceOffset even with no edge between them, and the scan reports it in linkOverrides
    const autoOn = { ...belowSma5, params: [p("skipBars", 0), p("period", 5), p("direction", "below")] };
    const al = await scan([thought("a", never20), thought("b", autoOn), results],
      [{ id: "e1", source: "a", target: "results", logicType: "OR" }, { id: "e2", source: "b", target: "results", logicType: "OR" }]);
    assert.equal(al.linkOverrides.length, 1);
    assert.equal(al.linkOverrides[0].linkedValue, 5);
    assert.equal(al.results.length, 0, "B judged 5 bars back by the auto-link, where it is above its SMA");

    // 4. FND-4 Earnings Proximity on stored earnings dates: A in 10 days, B none, C in 45 days
    const today = etDateKey();
    await sql(`INSERT INTO tickers (symbol, sector, industry, next_earnings_date) VALUES ($1, 'x', 'x', $2), ($3, 'x', 'x', NULL), ($4, 'x', 'x', $5)`,
      [A, addDays(today, 10), B, C, addDays(today, 45)]);
    const fnd4 = (inverted: boolean) => [{ ...thought("e", { indicatorId: "FND-4", label: "earnings", inverted, params: [p("skipBars", 0), p("minDays", 0), p("maxDays", 30)] }) }, results];
    const e1 = await scan(fnd4(false), [{ id: "e1", source: "e", target: "results", logicType: "AND" }]);
    assert.deepEqual(e1.results.map((x: any) => x.symbol), [A], "earnings within 30 days");
    assert.deepEqual(e1.earningsData, { namesWithDate: 2, names: 3 });
    const e2 = await scan(fnd4(true), [{ id: "e1", source: "e", target: "results", logicType: "AND" }]);
    assert.deepEqual(e2.results.map((x: any) => x.symbol), [C], "inverted: C (45 days); B has no date and is not a pass");
    // no dates at all: says so
    await sql(`UPDATE tickers SET next_earnings_date = NULL WHERE symbol = ANY($1)`, [[A, B, C]]);
    const e3 = await scan(fnd4(false), [{ id: "e1", source: "e", target: "results", logicType: "AND" }]);
    assert.equal(e3.results.length, 0);
    assert.match(e3.earningsData.warning, /no earnings dates were found/);

    console.log("scan-route: all checks passed");
  } finally {
    await h.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
