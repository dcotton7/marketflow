/**
 * Ticker Review scorer — AND/OR criteria engine (shared client + server).
 */

import { optionalFromPattern } from "./setup-detectors/enrich-member";
import type { PatternHit } from "./setup-detectors/types";
import type {
  DailyBarLike,
  OptionalCriterionId,
  RaiLabel,
  RequiredCriterionId,
  TickerReviewMember,
  TickerReviewScanMode,
} from "./ticker-review-types";

export type {
  DailyBarLike,
  OptionalCriterionId,
  RaiLabel,
  RequiredCriterionId,
  TickerReviewMember,
  TickerReviewScanMode,
} from "./ticker-review-types";

export type TickerReviewBucket =
  | "activating"
  | "setup_ready"
  | "setup_forming"
  | "emerging_rs"
  | "laggard_candidate"
  | "ur_repair"
  | "orb_watch";

export interface TightMaResult {
  fired: boolean;
  clusterSize: 0 | 2 | 3 | 4;
  masInCluster: string[];
  onStack: boolean;
  tier: "×2" | "×3" | "×4" | null;
}

export interface TickerReviewResultRow {
  symbol: string;
  watchScore: number;
  bucket: TickerReviewBucket;
  firedOptional: OptionalCriterionId[];
  summaryLines: string[];
  /** Rule-based prose — what Ivy reads from the scan signals */
  setupNarrative: string;
  patternHits: PatternHit[];
  tags: string[];
  tightMa: TightMaResult;
  rs: { vsSpy: number; rankInTheme: number; memberCount: number };
  structure: {
    pctVs20: number | null;
    pctVs50: number | null;
    pctVs200: number | null;
  };
  /** Last daily session % change when bar enrichment ran. */
  lastSessionPct?: number | null;
}

export interface TickerReviewScanInput {
  tickers: TickerReviewMember[];
  themeMedianPct?: number;
  mode: TickerReviewScanMode;
  enabledRequired: Set<RequiredCriterionId> | RequiredCriterionId[];
  enabledOptional: Set<OptionalCriterionId> | OptionalCriterionId[];
  raiLabel?: RaiLabel;
  themeRank?: number;
  maxResults?: number;
}

function asSet<T extends string>(v: Set<T> | T[]): Set<T> {
  return v instanceof Set ? v : new Set(v);
}

function pct(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(v) ? null : v;
}

export { detectHvcFromDailyBars } from "./setup-detectors/hvc";

export function computeTightMa(ticker: TickerReviewMember): TightMaResult {
  const entries: { key: string; label: string; v: number }[] = [];
  const e10 = pct(ticker.pctVsEma10d);
  const s20 = pct(ticker.pctVsSma20d);
  const s50 = pct(ticker.pctVsSma50d);
  const s200 = pct(ticker.pctVsSma200d);
  if (e10 != null) entries.push({ key: "10ema", label: "10 EMA", v: e10 });
  if (s20 != null) entries.push({ key: "20sma", label: "20 SMA", v: s20 });
  if (s50 != null) entries.push({ key: "50sma", label: "50 SMA", v: s50 });
  if (s200 != null) entries.push({ key: "200sma", label: "200 SMA", v: s200 });

  if (entries.length < 2) {
    return { fired: false, clusterSize: 0, masInCluster: [], onStack: false, tier: null };
  }

  let bestCluster: typeof entries = [];
  for (let i = 0; i < entries.length; i++) {
    const cluster = [entries[i]!];
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      const ok = cluster.every((c) => Math.abs(c.v - entries[j]!.v) <= 2);
      if (ok && !cluster.some((c) => c.key === entries[j]!.key)) {
        cluster.push(entries[j]!);
      }
    }
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }

  const clique = bestCluster.filter((a) =>
    bestCluster.every((b) => Math.abs(a.v - b.v) <= 2)
  );
  const size = clique.length as 0 | 2 | 3 | 4;
  if (size < 2) {
    return { fired: false, clusterSize: 0, masInCluster: [], onStack: false, tier: null };
  }

  const avgAbs = clique.reduce((s, c) => s + Math.abs(c.v), 0) / clique.length;
  const tier = size >= 4 ? "×4" : size === 3 ? "×3" : "×2";

  return {
    fired: true,
    clusterSize: size >= 4 ? 4 : size >= 3 ? 3 : 2,
    masInCluster: clique.map((c) => c.label),
    onStack: avgAbs <= 5,
    tier,
  };
}

function resolveMode(
  mode: TickerReviewScanMode,
  raiLabel?: string,
  themeRank?: number
): Exclude<TickerReviewScanMode, "auto"> {
  if (mode !== "auto") return mode;
  if (raiLabel === "DEFENSIVE") return "emerging";
  if (themeRank != null && themeRank <= 5) return "laggard";
  if (raiLabel === "AGGRESSIVE") return "leadership";
  return "leadership";
}

function rs(t: TickerReviewMember): number {
  return t.rsVsSpy ?? 0;
}

function evalOptional(
  id: OptionalCriterionId,
  t: TickerReviewMember,
  ctx: {
    n: number;
    themeMedianPct: number;
    tightMa: TightMaResult;
    mode: Exclude<TickerReviewScanMode, "auto">;
  }
): boolean {
  const barBacked: OptionalCriterionId[] = ["O5", "O6", "O7", "O8", "O9", "O10"];
  if (barBacked.includes(id)) {
    const fromPattern = optionalFromPattern(t, id);
    if (fromPattern !== null) return fromPattern;
  }

  const p20 = pct(t.pctVsSma20d);
  const p50 = pct(t.pctVsSma50d);
  const p200 = pct(t.pctVsSma200d);
  const rank = t.rsRank ?? ctx.n;
  const top40 = rank <= Math.max(1, Math.ceil(ctx.n * 0.4));
  const rsVal = rs(t);

  switch (id) {
    case "O1":
      return top40 && rsVal > 0;
    case "O2":
      return (
        (t.accDistDays ?? 0) >= 1 &&
        (t.pct > ctx.themeMedianPct || rsVal > 0)
      );
    case "O3":
      return (
        ctx.mode === "laggard" &&
        rank > Math.ceil(ctx.n * 0.4) &&
        p50 != null &&
        p50 >= 2 &&
        p50 <= 12 &&
        ctx.tightMa.fired
      );
    case "O4":
      return ctx.tightMa.fired;
    case "O5": {
      const reclaim50 = p50 != null && p50 >= -1 && p50 <= 4 && t.trendState !== "Bear";
      const reclaim20 = p20 != null && p20 >= -1 && p20 <= 3;
      const below200reclaim = p200 != null && p200 < 0 && p200 > -8 && p50 != null && p50 > 0;
      return reclaim50 || reclaim20 || below200reclaim;
    }
    case "O6":
      return (
        ctx.tightMa.fired &&
        (t.volExp ?? 1) < 1.15 &&
        p50 != null &&
        p50 >= -5 &&
        p50 <= 10
      );
    case "O7":
      if (t.hvcPriorSession === true) return true;
      if (t.hvcPriorSession === false) return false;
      return (t.volExp ?? 0) >= 1.4 && t.pct > 0 && (t.prevDayVolExp ?? 0) >= 1.3;
    case "O8":
      return t.pct >= 2 && t.pct <= 8 && p20 != null && p20 >= 0;
    case "O9":
      return ctx.tightMa.fired && (t.volExp ?? 0) >= 1.1 && t.pct >= 0;
    case "O10":
      return t.pct >= 1.5 && (t.volExp ?? 0) >= 1.25 && top40;
    case "O11":
      return (t.accDistDays ?? 0) >= 3 && top40;
    default:
      return false;
  }
}

function passesRequired(
  id: RequiredCriterionId,
  t: TickerReviewMember,
  ctx: {
    n: number;
    mode: Exclude<TickerReviewScanMode, "auto">;
    urFired: boolean;
  }
): boolean {
  const p50 = pct(t.pctVsSma50d);
  const p200 = pct(t.pctVsSma200d);

  switch (id) {
    case "R3":
      if (p200 != null && p200 < -10 && t.trendState === "Bear" && !ctx.urFired) return false;
      return true;
    case "R4":
      if (p50 != null && p50 > 18) return false;
      return true;
    case "R5":
      return (t.volExp ?? 0) >= 0.85 || (t.accDistDays ?? 0) >= 0 || Math.abs(t.pct) > 0.01;
    case "R6": {
      const rank = t.rsRank ?? ctx.n;
      const rsVal = rs(t);
      if (ctx.mode === "leadership") return rsVal >= -0.3 && rank <= Math.ceil(ctx.n / 2);
      if (ctx.mode === "emerging") return true;
      if (ctx.mode === "laggard") return p50 == null || p50 <= 12;
      if (ctx.mode === "repair") return ctx.urFired || (p200 != null && p200 > -12);
      return true;
    }
    default:
      return true;
  }
}

function pickBucket(
  fired: OptionalCriterionId[],
  mode: Exclude<TickerReviewScanMode, "auto">
): TickerReviewBucket {
  if (fired.includes("O9")) return "orb_watch";
  if (fired.includes("O10") || fired.includes("O8")) return "activating";
  if (fired.includes("O5") && mode === "repair") return "ur_repair";
  if (fired.includes("O3")) return "laggard_candidate";
  if (fired.includes("O2")) return "emerging_rs";
  if (fired.includes("O6")) return "setup_forming";
  if (fired.includes("O4") || fired.includes("O1")) return "setup_ready";
  return "setup_forming";
}

function buildSummaryLines(
  t: TickerReviewMember,
  tightMa: TightMaResult,
  firedOptional: OptionalCriterionId[],
  urFired: boolean
): string[] {
  const rsVal = rs(t);
  const lines: string[] = [
    `RS ${rsVal >= 0 ? "+" : ""}${rsVal.toFixed(2)} vs SPY · #${t.rsRank ?? "?"} in theme`,
  ];
  if (tightMa.fired) {
    lines.push(
      `Tight MAs (${tightMa.clusterSize}): ${tightMa.masInCluster.join(", ")}${tightMa.onStack ? " · on stack" : ""}`
    );
  }
  if (t.pctVsSma50d != null) {
    lines.push(
      `Structure: ${t.pctVsSma20d != null ? `${t.pctVsSma20d.toFixed(1)}% vs 20d · ` : ""}${t.pctVsSma50d.toFixed(1)}% vs 50d`
    );
  }
  if (firedOptional.includes("O7")) {
    const baseHit = t.patternHits?.find((h) => h.criterionId === "O7" || h.pattern === "long_base");
    if (baseHit?.diagnostics?.gapDate && baseHit.diagnostics?.baseDays != null) {
      const gapPct = baseHit.diagnostics.gapPct ?? "?";
      const days = baseHit.diagnostics.baseDays;
      lines.push(
        `Long base (${days}d) since ${baseHit.diagnostics.gapDate} gap (+${gapPct}%) — post-gap consolidation`
      );
    } else if (baseHit) {
      lines.push(`Long base · ${baseHit.stage.replace(/_/g, " ")} (${Number(baseHit.confidence).toFixed(2)}% conf)`);
    } else {
      lines.push("HVC prior session — watch for follow-through / pullback hold");
    }
  }
  if (firedOptional.includes("O9")) {
    lines.push("ORB setup — AM action if range breaks with volume");
  }
  for (const hit of t.patternHits ?? []) {
    if (!firedOptional.includes(hit.criterionId)) continue;
    const label = hit.pattern.replace(/_/g, " ");
    lines.push(`${label} · ${hit.stage} (${Number(hit.confidence).toFixed(2)}% conf)`);
  }
  const p200 = pct(t.pctVsSma200d);
  if (p200 != null) {
    if (p200 < 0) {
      lines.push(`200d: ${p200.toFixed(1)}% below SMA${urFired ? " · U&R reclaim in play" : " · longer-term headwind"}`);
    } else if (p200 < 3) {
      lines.push(`200d: near/above SMA (+${p200.toFixed(1)}%)`);
    }
  }
  if (urFired || firedOptional.includes("O5")) {
    const urHit = t.patternHits?.find((h) => h.criterionId === "O5" || h.pattern === "undercut_rally");
    if (urHit) {
      lines.push(`U&R: ${urHit.stage.replace(/_/g, " ")} (${Number(urHit.confidence).toFixed(2)}% conf)`);
    } else if (!lines.some((l) => l.includes("U&R"))) {
      lines.push("U&R: reclaiming 20d / 50d / 200d after pullback");
    }
  }
  return lines;
}

function rsTone(rsVal: number, rank: number, memberCount: number): string {
  const top40 = rank <= Math.max(1, Math.ceil(memberCount * 0.4));
  if (top40 && rsVal > 0.5) return "strong relative strength vs SPY and leadership within the theme";
  if (top40 && rsVal > 0) return "positive RS vs SPY with theme sponsorship intact";
  if (rsVal > 0) return "RS vs SPY holding positive despite a mid-pack theme rank";
  if (rsVal > -0.3) return "RS vs SPY is neutral — not leading, but not broken";
  return "RS vs SPY is soft — treat as a repair or mean-reversion idea only";
}

function format200dNarrative(p200: number | null, urFired: boolean): string | null {
  if (p200 == null) return null;
  if (p200 >= 2) {
    return `Long-term trend is supportive — trading ${p200.toFixed(1)}% above the 200-day SMA.`;
  }
  if (p200 >= 0) {
    return `Near the 200-day SMA (+${p200.toFixed(1)}%) — long-term trend is roughly neutral, not a major tailwind or headwind.`;
  }
  if (p200 >= -5) {
    return urFired
      ? `Living just below the 200-day (${p200.toFixed(1)}%) while staging a U&R reclaim — the 200d line is the key tell.`
      : `Living below the 200-day SMA (${p200.toFixed(1)}%) — longer-term trend is still a headwind even if the near-term coil looks constructive.`;
  }
  return urFired
    ? `Still ${Math.abs(p200).toFixed(1)}% below the 200-day, but U&R repair is active — need a sustained reclaim before sizing up.`
    : `Caution: ${Math.abs(p200).toFixed(1)}% below the 200-day SMA — treat as repair/mean-reversion only unless structure improves.`;
}

function formatUrNarrative(
  t: TickerReviewMember,
  urFired: boolean,
  firedOptional: OptionalCriterionId[],
  opts?: { skipRecaptureWatch?: boolean }
): string | null {
  if (!urFired && !firedOptional.includes("O5")) return null;
  const hit = t.patternHits?.find((h) => h.criterionId === "O5" || h.pattern === "undercut_rally");
  if (hit) {
    const stage = hit.stage.replace(/_/g, " ");
    return `U&R pattern (${stage}, ${Number(hit.confidence).toFixed(2)}% confidence): undercut-and-rally detected — watch for price to hold above reclaimed MAs.`;
  }
  if (opts?.skipRecaptureWatch) return null;
  return "U&R is in play — price is reclaiming the 20d/50d/200d zone after a pullback; a sustained hold above those lines upgrades this from watch to actionable.";
}

/** Price-action-first opener when MA structure tells a clear session story (e.g. CL U&R coil). */
function buildPriceActionLead(
  t: TickerReviewMember,
  urFired: boolean,
  firedOptional: OptionalCriterionId[]
): string | null {
  const p10 = pct(t.pctVsEma10d);
  const p20 = pct(t.pctVsSma20d);
  const p200 = pct(t.pctVsSma200d);
  const lastPct = pct(t.lastSessionPct);
  const below10and20 = p10 != null && p20 != null && p10 < -0.25 && p20 < -0.25;
  const near200 = p200 != null && p200 >= -2.5 && p200 <= 3;
  const urContext = urFired || firedOptional.includes("O5") || near200;

  if (below10and20) {
    const chunks: string[] = [`${t.symbol} shows recent positive price action`];
    if (near200) chunks.push(" after a visit to the 200-day SMA");
    if (lastPct != null && lastPct >= 3.5) {
      chunks.push(`, rallied ${lastPct.toFixed(1)}% on the last session`);
    } else if ((t.pct ?? 0) >= 2) {
      chunks.push(`, firm on a ${t.pct.toFixed(1)}% recent leg`);
    }
    if (lastPct != null && lastPct < -0.5) {
      chunks.push(
        chunks.some((c) => c.includes("rallied") || c.includes("firm"))
          ? ` before finishing with a ${Math.abs(lastPct).toFixed(1)}% pullback`
          : `, but the last session pulled back ${Math.abs(lastPct).toFixed(1)}%`
      );
    }
    chunks.push(", closing below the 10 EMA and 20 SMA");
    if (urContext) {
      chunks.push(
        " — look for a recapture of the 10 EMA and 20 SMA for a textbook undercut-and-rally entry over the next session or two"
      );
    }
    return `${chunks.join("")}.`;
  }

  if (near200 && (t.pct ?? 0) >= 1.5) {
    const tail = urContext
      ? " Watch for a sustained reclaim of the 10 EMA and 20 SMA to confirm the repair."
      : "";
    return `${t.symbol} is working constructive price action around the 200-day SMA on a ${t.pct.toFixed(1)}% recent leg — sponsorship is building but the setup still needs a clean trigger.${tail}`;
  }

  if (lastPct != null && lastPct >= 5 && p20 != null && p20 < 4) {
    return `${t.symbol} ripped ${lastPct.toFixed(1)}% on the last session — momentum is turning, but extension vs the 20-day (${p20.toFixed(1)}%) argues for a measured entry rather than chasing.`;
  }

  return null;
}

function buildSetupTriggerNarrative(
  firedOptional: OptionalCriterionId[]
): string | null {
  if (firedOptional.includes("O7")) {
    return "Gap-forward long base or prior-session HVC sponsorship — watch consolidation hold, vol dry-up, and a pivot break above the base ceiling.";
  }
  if (firedOptional.includes("O9")) {
    return "Plan around the opening range: a break with volume expansion is the trigger; chop inside the range favors waiting.";
  }
  if (firedOptional.includes("O10") || firedOptional.includes("O8")) {
    return "Breakout or gap-and-go signals are live — prioritize volume confirmation before sizing up.";
  }
  if (firedOptional.includes("O3")) {
    return "As a theme laggard, the edge is patience: leaders have already moved; this name needs a clean trigger before chasing.";
  }
  return null;
}

function buildSetupNarrative(
  t: TickerReviewMember,
  tightMa: TightMaResult,
  firedOptional: OptionalCriterionId[],
  bucket: TickerReviewBucket,
  urFired: boolean,
  memberCount: number
): string {
  const rsVal = rs(t);
  const rank = t.rsRank ?? memberCount;
  const p20 = pct(t.pctVsSma20d);
  const p50 = pct(t.pctVsSma50d);
  const p200 = pct(t.pctVsSma200d);
  const sentences: string[] = [];
  const priceLead = buildPriceActionLead(t, urFired, firedOptional);
  const priceLeadMentions200 = priceLead?.includes("200-day") ?? false;
  const priceLeadMentionsUr = priceLead?.includes("undercut-and-rally") ?? false;

  const bucketLead: Record<TickerReviewBucket, string> = {
    activating:
      `${t.symbol} looks like it is activating — price and volume are expanding in a way that often precedes a follow-through move.`,
    setup_ready:
      `${t.symbol} is coiled in a setup-ready posture — structure is constructive and the name is not extended.`,
    setup_forming:
      `${t.symbol} is early-stage: sponsorship is building but the setup is still forming rather than fully triggered.`,
    emerging_rs:
      `${t.symbol} shows emerging relative strength — accumulation and theme-relative performance are improving.`,
    laggard_candidate:
      `${t.symbol} is a laggard candidate in a hot theme — still behind the leaders but tightening up for a potential catch-up move.`,
    ur_repair:
      `${t.symbol} is a U&R repair candidate — price is attempting to reclaim key moving averages after a pullback.`,
    orb_watch:
      `${t.symbol} sets up for an opening-range break — the AM session is the decision point if volume confirms.`,
  };
  sentences.push(priceLead ?? bucketLead[bucket]);

  sentences.push(
    `I see ${rsTone(rsVal, rank, memberCount)} (#${rank} of ${memberCount} in theme).`
  );

  if (!priceLead && tightMa.fired) {
    const stackNote = tightMa.onStack ? " and price is riding the stack" : "";
    sentences.push(
      `Moving averages are tight (${tightMa.masInCluster.join(", ")}, ${tightMa.tier} cluster)${stackNote} — classic coiling before a directional push.`
    );
  } else if (!priceLead && p50 != null) {
    const ext =
      p50 > 12 ? "extended above the 50-day" : p50 < -3 ? "below the 50-day but not deeply broken" : "near the 50-day line";
    const p20bit = p20 != null ? ` · ${p20.toFixed(1)}% vs 20d` : "";
    sentences.push(`Structure sits ${p50.toFixed(1)}% vs the 50-day SMA${p20bit} — ${ext}.`);
  } else if (priceLead && tightMa.fired && !priceLeadMentionsUr) {
    sentences.push(
      `MAs remain tight (${tightMa.masInCluster.join(", ")}, ${tightMa.tier} cluster) — coiling under the surface while price digests the move.`
    );
  }

  if (!priceLeadMentions200) {
    const note200 = format200dNarrative(p200, urFired);
    if (note200) sentences.push(note200);
  }

  const noteUr = formatUrNarrative(t, urFired, firedOptional, {
    skipRecaptureWatch: priceLeadMentionsUr,
  });
  if (noteUr) sentences.push(noteUr);

  const trigger = buildSetupTriggerNarrative(firedOptional);
  if (trigger) sentences.push(trigger);

  if (sentences.length < 4) {
    sentences.push(
      "Not extended enough to chase blindly — let price prove the next leg with volume before committing size."
    );
  }

  return sentences.slice(0, 5).join(" ");
}

export function runTickerReviewScan(input: TickerReviewScanInput): {
  results: TickerReviewResultRow[];
  hiddenCount: number;
  effectiveMode: Exclude<TickerReviewScanMode, "auto">;
} {
  const {
    tickers,
    themeMedianPct = 0,
    mode,
    enabledRequired,
    enabledOptional,
    raiLabel,
    themeRank,
    maxResults = 10,
  } = input;

  const reqSet = asSet(enabledRequired);
  const optSet = asSet(enabledOptional);
  const effectiveMode = resolveMode(mode, raiLabel, themeRank);
  const n = tickers.length;
  let hiddenCount = 0;
  const results: TickerReviewResultRow[] = [];

  for (const t of tickers) {
    const tightMa = computeTightMa(t);
    const urFired = evalOptional("O5", t, { n, themeMedianPct, tightMa, mode: effectiveMode });

    let requiredOk = true;
    for (const rid of reqSet) {
      if (!passesRequired(rid, t, { n, mode: effectiveMode, urFired })) {
        requiredOk = false;
        break;
      }
    }
    if (!requiredOk) {
      hiddenCount++;
      continue;
    }

    const firedOptional: OptionalCriterionId[] = [];
    for (const oid of optSet) {
      if (evalOptional(oid, t, { n, themeMedianPct, tightMa, mode: effectiveMode })) {
        firedOptional.push(oid);
      }
    }

    if (optSet.size > 0 && firedOptional.length === 0) {
      hiddenCount++;
      continue;
    }

    let watchScore = 40 + firedOptional.length * 6;
    if (tightMa.clusterSize === 4) watchScore += 20;
    else if (tightMa.clusterSize === 3) watchScore += 14;
    else if (tightMa.clusterSize === 2) watchScore += 8;
    if (pct(t.pctVsSma200d) != null && pct(t.pctVsSma200d)! < -5 && !urFired) watchScore -= 25;
    if (firedOptional.includes("O7")) watchScore += 10;

    const bucket = pickBucket(firedOptional, effectiveMode);
    const tags: string[] = [];
    if (tightMa.tier) tags.push(`Tight MA ${tightMa.tier}`);
    if (tightMa.onStack) tags.push("On stack");
    for (const f of firedOptional) tags.push(f);

    results.push({
      symbol: t.symbol,
      watchScore: Math.round(Math.min(100, Math.max(0, watchScore))),
      bucket,
      firedOptional,
      summaryLines: buildSummaryLines(t, tightMa, firedOptional, urFired),
      setupNarrative: buildSetupNarrative(t, tightMa, firedOptional, bucket, urFired, n),
      patternHits: t.patternHits ?? [],
      tags,
      tightMa,
      rs: { vsSpy: rs(t), rankInTheme: t.rsRank ?? n, memberCount: n },
      structure: {
        pctVs20: pct(t.pctVsSma20d),
        pctVs50: pct(t.pctVsSma50d),
        pctVs200: pct(t.pctVsSma200d),
      },
      lastSessionPct: pct(t.lastSessionPct),
    });
  }

  results.sort((a, b) => b.watchScore - a.watchScore);
  const capped = results.slice(0, Math.max(1, maxResults));
  hiddenCount += results.length - capped.length;

  return { results: capped, hiddenCount, effectiveMode };
}

export const BUCKET_LABELS: Record<TickerReviewBucket, string> = {
  activating: "Activating",
  setup_ready: "Setup ready",
  setup_forming: "Setup forming",
  emerging_rs: "Emerging RS",
  laggard_candidate: "Laggard candidate",
  ur_repair: "U&R repair",
  orb_watch: "ORB watch",
};

export const SCAN_MODE_LABELS: Record<TickerReviewScanMode, string> = {
  auto: "Auto (from RAI / theme)",
  leadership: "Leadership",
  emerging: "Emerging RS",
  laggard: "Laggard hunt",
  repair: "U&R repair",
};
