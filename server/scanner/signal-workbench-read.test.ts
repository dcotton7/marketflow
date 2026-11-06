import assert from "node:assert/strict";
import type { EvidenceSnapshot, SignalTypeEvidence } from "./evidence-service";
import {
  EVENTS_PAGE_SIZE,
  HORIZONS,
  adjustedMove,
  buildEventsPage,
  buildGrades,
  parseEventsQuery,
  parseGradesQuery,
  shapeEvent,
} from "./signal-workbench-read";

const NOW = new Date("2026-11-06T15:00:00Z");

// ── Query parsing ───────────────────────────────────────────────────────────
assert.deepEqual(parseGradesQuery({}, NOW), { from: "2026-10-07", to: "2026-11-06", hitThreshold: 0.5, minSamples: 5, trust: "auto" },
  "the hit-rates route's defaults");
assert.deepEqual(parseGradesQuery({ from: "2026-10-01", to: "2026-10-31", hit_threshold: "1", min_samples: "10", trust: "trusted" }, NOW),
  { from: "2026-10-01", to: "2026-10-31", hitThreshold: 1, minSamples: 10, trust: "trusted" });
for (const q of [{ from: "2026-13-01" }, { to: "yesterday" }, { from: "2026-11-05", to: "2026-11-01" }, { hit_threshold: "x" },
  { min_samples: "0" }, { min_samples: "2.5" }, { trust: "everything" }]) {
  assert.ok("error" in parseGradesQuery(q, NOW), `refused ${JSON.stringify(q)}`);
}

assert.deepEqual(parseEventsQuery({}, NOW), { from: "2026-10-07", to: "2026-11-06", type: null, page: 1, pageSize: EVENTS_PAGE_SIZE });
assert.deepEqual(parseEventsQuery({ from: "2026-11-02", to: "2026-11-03", type: "volume_spike", page: "3" }, NOW),
  { from: "2026-11-02", to: "2026-11-03", type: "volume_spike", page: 3, pageSize: 100 });
assert.equal((parseEventsQuery({ type: "all" }, NOW) as any).type, null, "type=all is every type");
assert.equal((parseEventsQuery({ page: ["2", "9"] }, NOW) as any).page, 2, "a repeated param takes the first");
for (const q of [{ page: "0" }, { page: "-1" }, { page: "1.5" }, { page: "two" }, { type: "gap'; drop table x" },
  { type: "x".repeat(33) }, { from: "2026-02-30" }]) {
  assert.ok("error" in parseEventsQuery(q, NOW), `refused ${JSON.stringify(q)}`);
}

// ── Grades: one row per signal type, the page's numbers at each horizon ─────
function ev(signalType: string, over: Partial<SignalTypeEvidence>): SignalTypeEvidence {
  return {
    signalType, trust: "provisional", totalFired: 50, episodes: 20, tracked: 20, coverage: 1, hitRate: 0.4,
    hitRateShrunk: 0.41, avgMove: 0.2, medianMove: null, avgPeakMove: null, avgGiveback: null, failRate: null,
    reversalRate: null, mfe3Rate: null, mae3Rate: null, confidence: 0.3, tier: "watch", preferredWindow: "15m", ...over,
  };
}
function snap(signalTypes: SignalTypeEvidence[], warnings: string[] = []): EvidenceSnapshot {
  return { signalTypes, cohorts: [], dateRange: { from: "a", to: "b" }, window: "15m", hitThreshold: 0.5,
    trustUsed: "provisional", qualityWarnings: warnings, generatedAt: "x" };
}
const gq = parseGradesQuery({}, NOW) as any;
const grades = buildGrades(gq, [
  { window: "15m", snapshot: snap([ev("gap", { tracked: 18, hitRate: 0.5, avgMove: 0.3 }), ev("lod_bounce", { totalFired: 400, tracked: 3, hitRate: null, avgMove: null, tier: "unknown" })], ["thin"]) },
  { window: "1mo", snapshot: snap([ev("gap", { tracked: 6, coverage: 0.3, hitRate: 0.333, avgMove: -1.2, tier: "weak" })], ["thin", "coverage"]) },
], NOW);
assert.deepEqual(grades.horizons, HORIZONS);
assert.equal(grades.horizons.length, 9, "15 minutes to a month");
assert.deepEqual(grades.signalTypes.map((s) => s.signalType), ["lod_bounce", "gap"], "most fired first, like the page");
const gap = grades.signalTypes[1];
assert.deepEqual(gap.horizons["15m"], { tracked: 18, coverage: 1, hitRate: 0.5, hitRateShrunk: 0.41, edge: 0.3, confidence: 0.3, tier: "watch" });
assert.equal(gap.horizons["1mo"]!.edge, -1.2, "edge is the page's direction-adjusted avgMove, sign kept");
assert.equal(gap.horizons["1hr"], null, "no snapshot row, no grade");
assert.equal(grades.signalTypes[0].horizons["15m"]!.hitRate, null, "thin samples stay null, as the page shows them");
assert.deepEqual(grades.qualityWarnings, ["thin", "coverage"], "warnings kept, deduped");
assert.equal(grades.generatedAt, NOW.toISOString());

// ── Events: each fire with its later prices, paged ──────────────────────────
assert.equal(adjustedMove("down", 2), -2);
assert.equal(adjustedMove("up", -1.5), -1.5);
assert.equal(adjustedMove("neutral", -1.5), 1.5);
assert.equal(adjustedMove("down", null), null);

const row = {
  id: 77, signal_type: "hod_fade", subject: "NVDA", subject_kind: "ticker", direction: "down", headline: "NVDA fades HOD",
  tickers: ["NVDA"], qualify_score: "78.5", created_at: new Date("2026-11-03T15:31:00Z"), session_at_signal: "regular",
  regime_at_signal: null, price_at_signal: 200, price_15m: 198, move_15m: -1, price_30m: null, move_30m: null,
  price_1mo: "210", move_1mo: "5", peak_move: 1.4, worst_drawdown: -0.5, giveback_pct: 20, outcome_status: "profitable",
  outcome_failed: false, outcome_contract_version: "v3", outcome_tracked_at: "2026-11-03T16:31:00Z", intraday_complete_at: null,
  episode_rank: 1, episode: true, context_json: { secret: 1 },
};
const e = shapeEvent(row);
assert.equal(e.id, 77);
assert.equal(e.episode, true);
assert.equal(e.qualifyScore, 78.5);
assert.equal(e.createdAt, "2026-11-03T15:31:00.000Z");
assert.deepEqual(e.outcomes["15m"], { price: 198, move: -1, edge: 1 }, "a short's drop is a favorable edge");
assert.deepEqual(e.outcomes["30m"], { price: null, move: null, edge: null }, "not filled yet");
assert.deepEqual(e.outcomes["1mo"], { price: 210, move: 5, edge: -5 });
assert.deepEqual(Object.keys(e.outcomes), HORIZONS);
assert.equal(e.outcomeTrackedAt, "2026-11-03T16:31:00.000Z");
assert.equal(e.intradayCompleteAt, null);
assert.ok(!("context" in e) && !("contextJson" in e), "context_json stays out");
assert.equal(shapeEvent({ ...row, episode: false, episode_rank: 2 }).episode, false, "a repeat fire is not an episode");
assert.equal(shapeEvent({ ...row, direction: "neutral", episode: false, episode_rank: 1 }).episode, false, "a non-directional fire is never an episode");

const eq = parseEventsQuery({ page: "2" }, NOW) as any;
const page = buildEventsPage(eq, 250, [row]);
assert.equal(page.page, 2);
assert.equal(page.pageSize, 100);
assert.equal(page.total, 250);
assert.equal(page.totalPages, 3);
assert.equal(page.hasMore, true);
assert.equal(page.events.length, 1);
const last = buildEventsPage({ ...eq, page: 3 }, 250, []);
assert.equal(last.hasMore, false);
const empty = buildEventsPage({ ...eq, page: 1 }, 0, []);
assert.equal(empty.totalPages, 1);
assert.equal(empty.hasMore, false);

console.log("signal workbench read ok");
