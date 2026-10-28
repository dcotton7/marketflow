import { createHash } from "node:crypto";
import { CYCLE_VERSION, DEFAULT_CYCLE_PARAMS, type CycleParams } from "./cycle";
import { BASELINE_EXIT, DEFAULT_COSTS, DYNAMIC_EXIT, assertExitPolicy, type CostModel, type ExitPolicy } from "./exit-policy";
import { DEFAULT_THRESHOLDS, type RuleName, type RuleThresholds } from "./rules";
import { ENTRY_SETUPS } from "./setups";

/**
 * A strategy version as one immutable package (spec section 7). Changing anything makes a new version; the content
 * hash identifies it. The llm / specialist / learnedModel blocks are seams for phases 3 and 5 and stay off here.
 */
export interface StrategyPackage {
  id: string;
  parentId: string | null;
  setups: { id: string; params?: Record<string, number> }[];
  rules: { required: RuleName[]; thresholds: RuleThresholds };
  cycle: { version: string; params: CycleParams };
  regimeFilters: never[];
  exitPolicy: ExitPolicy;
  params: {
    accountRiskPct: number;
    maxPositions: number;
    maxPositionPct: number;
    /** 0 = skip when the logical stop is over 5% away; N = wait N sessions for a price within 5% of it. */
    waitSessions: number;
    startingEquity: number;
    costs: CostModel;
  };
  llm: { enabled: false; model?: string; promptVersion?: string };
  specialist: { enabled: false };
  learnedModel: { enabled: false };
  createdBy: "don" | "critic" | "manual";
  changeNote: string;
  status: "draft" | "challenger" | "paper" | "champion" | "retired";
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export function packageHash(p: StrategyPackage): string {
  const { status: _s, ...content } = p;
  return createHash("sha256").update(stableStringify(content)).digest("hex").slice(0, 12);
}

const ALL_ENTRIES = ENTRY_SETUPS.map((s) => ({ id: s.id }));
const BASE_REQUIRED: RuleName[] = ["price_min", "dollar_volume_min", "stage_fit", "cycle_not_2c", "no_avoid_flag"];

const base: Omit<StrategyPackage, "id" | "changeNote"> = {
  parentId: null,
  setups: ALL_ENTRIES,
  rules: { required: BASE_REQUIRED, thresholds: DEFAULT_THRESHOLDS },
  cycle: { version: CYCLE_VERSION, params: DEFAULT_CYCLE_PARAMS },
  regimeFilters: [],
  exitPolicy: DYNAMIC_EXIT,
  params: { accountRiskPct: 0.01, maxPositions: 10, maxPositionPct: 0.25, waitSessions: 0, startingEquity: 100_000, costs: DEFAULT_COSTS },
  llm: { enabled: false },
  specialist: { enabled: false },
  learnedModel: { enabled: false },
  createdBy: "manual",
  status: "draft",
};

export const STRATEGY_VERSIONS: StrategyPackage[] = [
  {
    ...base,
    id: "kell-lib-v0",
    changeNote: "First version: every library setup, liquidity + cycle filters, extension-dependent 5/10/20 SMA trail, VIX trim table 5/10/15/25, trim cap 50%, Kell exits on.",
  },
  {
    ...base,
    id: "kell-lib-v0-baseline",
    parentId: "kell-lib-v0",
    exitPolicy: BASELINE_EXIT,
    changeNote: "Baseline exit on the same entries: fixed 10 SMA trail, flat 10% trims, Kell exits off.",
  },
  {
    ...base,
    id: "kell-lib-v0-strict",
    parentId: "kell-lib-v0",
    rules: { required: [...BASE_REQUIRED, "rs_rank", "rs_line_high", "rs_vs_qqq", "market_trend"], thresholds: DEFAULT_THRESHOLDS },
    changeNote: "Same as v0 plus every draft RS filter and the SPY 200 SMA market filter required.",
  },
  {
    ...base,
    id: "kell-lib-v0-wait",
    parentId: "kell-lib-v0",
    params: { ...base.params, waitSessions: 5 },
    changeNote: "Same as v0, but when the logical stop is over 5% away, wait up to 5 sessions for a price within 5% of it.",
  },
];

for (const v of STRATEGY_VERSIONS) assertExitPolicy(v.exitPolicy);

export function versionById(id: string): StrategyPackage {
  const v = STRATEGY_VERSIONS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown strategy version ${id}. Known: ${STRATEGY_VERSIONS.map((x) => x.id).join(", ")}`);
  return v;
}
