/**
 * Decides, for one BigIdea scan, the order thoughts are evaluated in, which edges carry
 * upstream data ("this happened, then that"), and whether a failed thought may stop the rest.
 *
 * Rule (Don, 26 Nov 2026: turn the optimizer off for "or" and linked ideas): an idea is evaluated
 * exactly as the user drew it. The cost-based reordering is allowed only for a "pure AND star":
 * every thought feeds Results directly by an AND edge and no thought links to another thought.
 * In that shape the final answer is the AND of every thought, so the order is irrelevant and
 * stopping at the first failure cannot change which names pass. Upstream data (patternEndBar,
 * basePeriod, ...) only ever flows along edges the user drew; the optimizer never adds any.
 *
 * Kill switch: BIGIDEA_QUERY_OPTIMIZER=off turns reordering off for every idea.
 */

export interface PlanThought {
  id: string;
  thoughtName?: string;
  isMuted?: boolean;
  thoughtCriteria?: Array<{ indicatorId: string; muted?: boolean }>;
}

export interface PlanEdge {
  source: string;
  target: string;
  logicType?: string;
}

export type OptimizeDecision =
  | { optimize: true; reason: string }
  | { optimize: false; reason: string };

export function optimizerEnabledBySetting(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.BIGIDEA_QUERY_OPTIMIZER || "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}

/**
 * True only when reordering + stop-at-first-failure is provably result-neutral.
 * `resultsId` is the Results node id; `thoughts` are the thought nodes the scan evaluates.
 */
export function decideOptimization(
  thoughts: PlanThought[],
  edges: PlanEdge[],
  resultsId: string | undefined,
  enabled: boolean = optimizerEnabledBySetting(),
): OptimizeDecision {
  if (!enabled) return { optimize: false, reason: "optimizer turned off by setting" };
  if (!resultsId) return { optimize: false, reason: "no Results node" };
  if (thoughts.length < 2) return { optimize: false, reason: "fewer than 2 thoughts" };

  const thoughtIds = new Set(thoughts.map((t) => String(t.id)));
  for (const e of edges) {
    const src = String(e.source);
    const tgt = String(e.target);
    if (!thoughtIds.has(src) && !thoughtIds.has(tgt)) continue;
    if ((e.logicType || "AND") !== "AND") {
      return { optimize: false, reason: "idea has an OR link: evaluated as written" };
    }
    if (thoughtIds.has(src) && thoughtIds.has(tgt)) {
      return { optimize: false, reason: "idea links thoughts (this happened, then that): evaluated as written" };
    }
    if (thoughtIds.has(tgt) && !thoughtIds.has(src)) {
      return { optimize: false, reason: "a thought has an input that is not a thought: evaluated as written" };
    }
    if (thoughtIds.has(src) && tgt !== String(resultsId)) {
      return { optimize: false, reason: "a thought feeds something other than Results: evaluated as written" };
    }
  }
  for (const id of thoughtIds) {
    const toResults = edges.filter((e) => String(e.source) === id && String(e.target) === String(resultsId));
    if (toResults.length === 0) {
      return { optimize: false, reason: "a thought is not wired to Results: evaluated as written" };
    }
  }
  return { optimize: true, reason: "pure AND: every thought feeds Results directly, order cannot change the answer" };
}

/**
 * For a scan: the edges that carry upstream data and gate a thought on its upstream passing.
 * Always the user's own thought-to-thought edges, never optimizer-made ones.
 */
export function dataEdgesFor(thoughts: PlanThought[], edges: PlanEdge[]): PlanEdge[] {
  const ids = new Set(thoughts.map((t) => String(t.id)));
  return edges.filter((e) => ids.has(String(e.source)) && ids.has(String(e.target)));
}
