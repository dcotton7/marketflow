/**
 * The query optimizer must never change which names pass (Don, 26 Nov 2026: "yes" to turning it off for
 * "or" and linked ideas). Fixed made-up bars, real indicators.
 *
 * The scan's per-name loop lives inside the /api/bigidea/scan handler (needs the DB and HTTP), so `runIdea`
 * below mirrors that loop's control flow: evaluation order, "skip if an upstream thought failed", upstream data
 * along thought-to-thought edges, stop-at-first-failure when optimized, and the Results AND/OR combine.
 * `legacy: true` reproduces the optimizer as it was (a sequential chain carrying data), to prove the old bug.
 */
import assert from "node:assert/strict";
import { INDICATOR_LIBRARY, normalizeResult, type CandleData } from "./indicators";
import { decideOptimization, dataEdgesFor, optimizerEnabledBySetting } from "./scan-plan";
import { autoOptimizeThoughtOrder, shouldAutoOptimize } from "./queryOptimizer";

type Crit = { indicatorId: string; params: Array<{ name: string; value: any }> };
type Node = { id: string; type: "thought" | "results"; thoughtName?: string; thoughtCriteria?: Crit[]; isNot?: boolean };
type Edge = { source: string; target: string; logicType?: "AND" | "OR" };

function evalThought(criteria: Crit[], candles: CandleData[], upstream?: Record<string, any>) {
  const out: Record<string, any> = {};
  let pass = true;
  for (const c of criteria) {
    const ind = INDICATOR_LIBRARY.find((i) => i.id === c.indicatorId)!;
    const params = Object.fromEntries(c.params.map((p) => [p.name, p.value]));
    const r = normalizeResult(ind.evaluate(candles, params, undefined, upstream ? { ...upstream } : {}));
    if (r.data) { const { _diagnostics, ...rest } = r.data as any; Object.assign(out, rest); }
    if (!r.pass) pass = false;
  }
  return { pass, out };
}

async function runIdea(nodes: Node[], edges: Edge[], candles: CandleData[], opts: { optimizer: boolean; legacy?: boolean }) {
  const thoughts = nodes.filter((n) => n.type === "thought");
  const results = nodes.find((n) => n.type === "results")!;
  let order = thoughts.slice(); // the fixtures are drawn in topological order already
  let dataEdges: Edge[] = dataEdgesFor(thoughts, edges);
  let stopAtFirstFailure = false;
  if (opts.legacy) {
    // the old rule: 2+ thoughts into Results, then rebuild as a chain A -> B -> ... that gates and carries data
    if (edges.filter((e) => e.target === results.id).length >= 2) {
      dataEdges = order.slice(1).map((t, i) => ({ source: order[i].id, target: t.id }));
    }
  } else if (decideOptimization(thoughts, edges, results.id, opts.optimizer).optimize) {
    const o = await autoOptimizeThoughtOrder(thoughts as any, edges, { universe: "test", timeframe: "daily" });
    order = o.nodes as any;
    assert.deepEqual(o.edges, edges, "the optimizer must not invent edges");
    stopAtFirstFailure = true;
  }
  const res: Record<string, boolean> = {};
  const outData: Record<string, Record<string, any>> = {};
  const skipped = new Set<string>();
  const downstream = (id: string): string[] => {
    const seen = new Set<string>(); const q = dataEdges.filter((e) => e.source === id).map((e) => e.target);
    while (q.length) { const c = q.shift()!; if (!seen.has(c)) { seen.add(c); q.push(...dataEdges.filter((e) => e.source === c).map((e) => e.target)); } }
    return [...seen];
  };
  const evaluated: string[] = [];
  for (const n of order) {
    if (skipped.has(n.id)) { res[n.id] = false; continue; }
    const ups = dataEdges.filter((e) => e.target === n.id).map((e) => e.source);
    if (ups.length && !ups.every((u) => res[u] === true)) { skipped.add(n.id); res[n.id] = false; continue; }
    const merged: Record<string, any> = {};
    for (const u of ups) Object.assign(merged, outData[u] || {});
    evaluated.push(n.id);
    const r = evalThought(n.thoughtCriteria!, candles, Object.keys(merged).length ? merged : undefined);
    let pass = r.pass; if (n.isNot) pass = !pass;
    res[n.id] = pass; outData[n.id] = r.out;
    if (!pass) {
      for (const d of downstream(n.id)) skipped.add(d);
      if (stopAtFirstFailure) for (const m of order) if (res[m.id] === undefined) skipped.add(m.id);
    }
  }
  const eff = (id: string): boolean => {
    const inc = edges.filter((e) => e.target === id);
    if (!inc.length) return res[id] ?? false;
    const and = inc.filter((e) => (e.logicType || "AND") === "AND").every((e) => eff(e.source));
    const ors = inc.filter((e) => e.logicType === "OR");
    const or = ors.length === 0 || ors.some((e) => eff(e.source));
    return id === results.id ? and && or : (res[id] ?? true) && and && or;
  };
  return { pass: eff(results.id), evaluated };
}

// newest first: rises from 100 (bar 10) to 110 (bar 5), then falls to 95 today
const closes = [95, 97, 99, 101, 104, 110, 108, 106, 104, 102, 100, ...Array(40).fill(100)];
const bars: CandleData[] = closes.map((c, i) => ({ date: `d${i}`, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1e6 }));

const runUp: Crit = { indicatorId: "PA-18", params: [ { name: "startBar", value: 10 }, { name: "period", value: 5 }, { name: "changeType", value: "gain" }, { name: "minChangePct", value: 5 }, { name: "maxChangePct", value: 100 } ] };
const aboveSma5: Crit = { indicatorId: "MA-1", params: [ { name: "skipBars", value: 0 }, { name: "period", value: 5 }, { name: "direction", value: "above" } ] };
const belowSma5: Crit = { indicatorId: "MA-1", params: [ { name: "skipBars", value: 0 }, { name: "period", value: 5 }, { name: "direction", value: "below" } ] };
const neverUp20: Crit = { indicatorId: "PA-18", params: [ { name: "startBar", value: 10 }, { name: "period", value: 5 }, { name: "changeType", value: "gain" }, { name: "minChangePct", value: 20 }, { name: "maxChangePct", value: 100 } ] };

async function main() {
  // sanity of the fixture: today is below its 5 SMA, bar 5 (where the run-up ended) is above it
  assert.equal(evalThought([belowSma5], bars).pass, true);
  assert.equal(evalThought([aboveSma5], bars).pass, false);
  assert.equal(evalThought([aboveSma5], bars, { patternEndBar: 5 }).pass, true);
  assert.equal(evalThought([runUp], bars).out.patternEndBar, 5);

  const R: Node = { id: "results", type: "results" };

  // 1. "A OR B" where the name passes only B (A = a 20% run that did not happen, B = below the 5 SMA today)
  {
    const nodes: Node[] = [ { id: "A", type: "thought", thoughtName: "A", thoughtCriteria: [neverUp20] }, { id: "B", type: "thought", thoughtName: "B", thoughtCriteria: [belowSma5] }, R ];
    const edges: Edge[] = [ { source: "A", target: "results", logicType: "OR" }, { source: "B", target: "results", logicType: "OR" } ];
    assert.equal(decideOptimization(nodes.slice(0, 2), edges, "results", true).optimize, false);
    assert.equal(shouldAutoOptimize(nodes.slice(0, 2) as any, edges), false);
    assert.equal((await runIdea(nodes, edges, bars, { optimizer: true, legacy: true })).pass, false, "the old optimizer dropped it (the bug)");
    assert.equal((await runIdea(nodes, edges, bars, { optimizer: true })).pass, true, "A OR B keeps a name that passes only B");
    assert.equal((await runIdea(nodes, edges, bars, { optimizer: false })).pass, true);
  }

  // 2. Two independent thoughts (A = run-up, B = above the 5 SMA), both AND into Results: B is judged today
  //    (fails); only when the user links A -> B is B judged at the bar A's pattern ended (passes).
  {
    const nodes: Node[] = [ { id: "A", type: "thought", thoughtName: "A", thoughtCriteria: [runUp] }, { id: "B", type: "thought", thoughtName: "B", thoughtCriteria: [aboveSma5] }, R ];
    const star: Edge[] = [ { source: "A", target: "results" }, { source: "B", target: "results" } ];
    assert.equal((await runIdea(nodes, star, bars, { optimizer: true, legacy: true })).pass, true, "the old optimizer silently time-linked them (the bug)");
    assert.equal((await runIdea(nodes, star, bars, { optimizer: true })).pass, false, "unlinked: B is evaluated today");
    assert.equal((await runIdea(nodes, star, bars, { optimizer: false })).pass, false);
    const linked: Edge[] = [ { source: "A", target: "B" }, { source: "B", target: "results" } ];
    assert.equal(decideOptimization(nodes.slice(0, 2), linked, "results", true).optimize, false);
    assert.equal((await runIdea(nodes, linked, bars, { optimizer: true })).pass, true, "linked: B is evaluated where A ended");
    // linked but also wired A -> Results: still never optimized
    assert.equal(decideOptimization(nodes.slice(0, 2), [...linked, { source: "A", target: "results" }], "results", true).optimize, false);
  }

  // 3. Pure AND: identical answers with the optimizer on and off, over several fixed ideas and bar series
  {
    const pool: Crit[] = [runUp, aboveSma5, belowSma5, neverUp20,
      { indicatorId: "MA-2", params: [ { name: "skipBars", value: 0 }, { name: "period", value: 10 }, { name: "direction", value: "below" } ] },
      { indicatorId: "VOL-1", params: [ { name: "period", value: 20 }, { name: "minMultiple", value: 0.5 } ] },
      { indicatorId: "PA-2", params: [ { name: "period", value: 14 }, { name: "minPct", value: 0 }, { name: "maxPct", value: 50 } ] } ];
    const series = [bars, [...bars].reverse().map((b, i) => ({ ...b, date: `r${i}` })), bars.map((b, i) => ({ ...b, close: b.close + (i % 3), high: b.high + 3 }))];
    let decided = 0, compared = 0;
    for (let a = 0; a < pool.length; a++) for (let b = 0; b < pool.length; b++) for (let c = 0; c < pool.length; c++) {
      if (a === b || b === c || a === c) continue;
      const nodes: Node[] = [ { id: "t1", type: "thought", thoughtName: "1", thoughtCriteria: [pool[a]] }, { id: "t2", type: "thought", thoughtName: "2", thoughtCriteria: [pool[b]], isNot: c % 2 === 0 }, { id: "t3", type: "thought", thoughtName: "3", thoughtCriteria: [pool[c]] }, R ];
      const edges: Edge[] = [ { source: "t1", target: "results", logicType: "AND" }, { source: "t2", target: "results" }, { source: "t3", target: "results", logicType: "AND" } ];
      if (decideOptimization(nodes.slice(0, 3), edges, "results", true).optimize) decided++;
      for (const s of series) {
        const on = await runIdea(nodes, edges, s, { optimizer: true });
        const off = await runIdea(nodes, edges, s, { optimizer: false });
        assert.equal(on.pass, off.pass, `pure AND ${a}/${b}/${c}`);
        compared++;
      }
    }
    assert.equal(decided, pool.length * (pool.length - 1) * (pool.length - 2), "every pure-AND star is still optimized");
    assert.ok(compared > 500);
  }

  // 4. the setting
  assert.equal(optimizerEnabledBySetting({}), true);
  assert.equal(optimizerEnabledBySetting({ BIGIDEA_QUERY_OPTIMIZER: "off" }), false);
  const star2: Edge[] = [ { source: "a", target: "r" }, { source: "b", target: "r" } ];
  assert.equal(decideOptimization([{ id: "a" }, { id: "b" }], star2, "r", false).optimize, false);
  assert.equal(decideOptimization([{ id: "a" }, { id: "b" }], star2, "r", true).optimize, true);
  // a thought not wired to Results must not be optimized (its failure would otherwise stop the others)
  assert.equal(decideOptimization([{ id: "a" }, { id: "b" }, { id: "c" }], star2, "r", true).optimize, false);

  console.log("scan-plan: all checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
