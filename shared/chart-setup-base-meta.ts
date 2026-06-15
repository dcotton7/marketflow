import type { SetupBar, SetupStage } from "./setup-detectors/types";
import {
  detectLongBase,
  detectRecentCoilBase,
  detectTightConsolidationBase,
} from "./setup-detectors/long-base";
import type { SetupDetectionResult } from "./setup-detectors/types";
import { normalizeSetupBars, sortBarsChronological } from "./setup-detectors/bars";
import { analyzeBase200dContext, type Reclaim200dReading } from "./chart-setup-base-200d";

export interface ChartSetupBaseMeta {
  detected: boolean;
  stage: SetupStage | null;
  gapDate: string | null;
  gapPct: number | null;
  baseDays: number | null;
  /** Pre-breakout coil length when distinct from baseDays. */
  consolidationDays?: number | null;
  baseRangePct: number | null;
  ceiling: number | null;
  floor: number | null;
  volContracting: boolean;
  confidence: number | null;
  summaryLines: string[];
  longSetupPositives: string[];
  /** Consolidation predominantly under the 200d SMA. */
  baseBelow200d?: boolean;
  reclaim200d?: Reclaim200dReading;
  /** Base below 200d + fresh 200d reclaim on last bar. */
  powerSetup?: boolean;
}

export interface ResolveBaseMetaInput {
  dailyCandles?: unknown[];
  sma200Series?: (number | null)[];
  sma50Series?: (number | null)[];
  lastSessionPct?: number | null;
  pctVs20?: number | null;
  pctVs50?: number | null;
  pctVs200?: number | null;
  scanRow?: {
    firedOptional?: string[];
    summaryLines?: string[];
    patternHits?: {
      pattern?: string;
      criterionId?: string;
      stage?: string;
      confidence?: number;
      diagnostics?: Record<string, unknown>;
    }[];
  } | null;
}

function emptyBaseMeta(): ChartSetupBaseMeta {
  return {
    detected: false,
    stage: null,
    gapDate: null,
    gapPct: null,
    baseDays: null,
    baseRangePct: null,
    ceiling: null,
    floor: null,
    volContracting: false,
    confidence: null,
    summaryLines: [],
    longSetupPositives: [],
  };
}

function toSetupBars(dailyCandles: unknown[]): SetupBar[] {
  return sortBarsChronological(normalizeSetupBars(dailyCandles));
}

function hitToBaseMeta(hit: ReturnType<typeof detectLongBase>): ChartSetupBaseMeta {
  const d = hit.diagnostics ?? {};
  const gapDate = typeof d.gapDate === "string" ? d.gapDate : null;
  const gapPctRaw = d.gapPct;
  const gapPct =
    typeof gapPctRaw === "string"
      ? parseFloat(gapPctRaw)
      : typeof gapPctRaw === "number"
        ? gapPctRaw
        : null;
  const baseDays = typeof d.baseDays === "number" ? d.baseDays : null;
  const consolidationDays =
    typeof d.consolidationDays === "number" ? d.consolidationDays : null;
  const baseRangePct =
    typeof d.baseRangePct === "string"
      ? parseFloat(d.baseRangePct)
      : typeof d.baseRangePct === "number"
        ? d.baseRangePct
        : null;
  const volContracting = d.volContracting === true;
  const ceiling = typeof d.ceiling === "number" ? d.ceiling : hit.entry;
  const floor = typeof d.floor === "number" ? d.floor : hit.stop;
  const brokeOut = d.brokeOut === true;
  const anchor =
    d.anchor === "recent_coil"
      ? "recent_coil"
      : d.anchor === "tight_box"
        ? "tight_box"
        : "gap_forward";

  const summaryLines: string[] = [];
  const longSetupPositives: string[] = [];

  if (anchor === "recent_coil" && baseDays != null && gapDate != null) {
    const tightLabel =
      baseRangePct != null && baseRangePct <= 10 ? "Tight" : "Orderly";
    summaryLines.push(
      `${tightLabel} base (${baseDays}d) since ${gapDate} — recent mid-chart coil (focus here, not older structure)`
    );
    longSetupPositives.push(`${tightLabel} ${baseDays}d coil — current actionable base`);
  } else if (anchor === "gap_forward" && gapDate != null && gapPct != null && baseDays != null) {
    summaryLines.push(
      `Long base (${baseDays}d) since ${gapDate} gap (+${gapPct.toFixed(2)}%) — post-gap consolidation`
    );
    longSetupPositives.push(`Gap-forward base building since ${gapDate} (${baseDays} sessions)`);
  } else if (baseDays != null) {
    summaryLines.push(`Long base (${baseDays}d) — multi-week consolidation on the daily chart`);
    longSetupPositives.push("Multi-week consolidation base");
  }

  if (baseRangePct != null && ceiling != null && floor != null) {
    summaryLines.push(
      `Base box ~${baseRangePct.toFixed(1)}% deep ($${floor.toFixed(2)}–$${ceiling.toFixed(2)})`
    );
    if (baseRangePct <= 15) {
      longSetupPositives.push(`Tight ${baseRangePct.toFixed(1)}% range — constructive coil`);
    } else if (baseRangePct <= 28) {
      longSetupPositives.push(`Orderly ${baseRangePct.toFixed(1)}% base — decent long setup structure`);
    }
  }

  if (volContracting) {
    summaryLines.push("Volume contracting through the base — supply drying up");
    longSetupPositives.push("Vol dry-up through base");
  }

  if (hit.stage === "triggered" || hit.stage === "extended") {
    summaryLines.push(
      `Built a ${baseDays ?? "multi-week"} day base — now ${hit.stage} above $${ceiling?.toFixed(2) ?? "?"} pivot`
    );
    longSetupPositives.push("Base complete — breakout / trigger leg underway");
  } else if (hit.stage === "ready") {
    summaryLines.push("Price coiled near base ceiling — watch for pivot break");
    longSetupPositives.push("Coiled under ceiling — pivot watch");
  } else if (hit.stage === "forming") {
    summaryLines.push(
      brokeOut
        ? "Consolidation base formed — monitoring follow-through"
        : "Still inside the base — not extended above ceiling"
    );
  }

  return {
    detected: true,
    stage: hit.stage,
    gapDate,
    gapPct,
    baseDays,
    consolidationDays,
    baseRangePct,
    ceiling,
    floor,
    volContracting,
    confidence: hit.confidence,
    summaryLines: summaryLines.slice(0, 4),
    longSetupPositives: longSetupPositives.slice(0, 4),
  };
}

export function baseMetaFromPatternHit(hit: {
  stage?: string;
  confidence?: number;
  diagnostics?: Record<string, unknown>;
}): ChartSetupBaseMeta | null {
  const d = hit.diagnostics ?? {};
  if (d.anchor !== "gap_forward" && d.anchor !== "tight_box" && d.baseDays == null) return null;

  const fakeHit = {
    detected: true,
    pattern: "long_base" as const,
    criterionId: "O7" as const,
    stage: (hit.stage as SetupStage) ?? "forming",
    confidence: hit.confidence ?? 60,
    entry: typeof d.ceiling === "number" ? d.ceiling : null,
    stop: typeof d.floor === "number" ? d.floor : null,
    target: null,
    diagnostics: d,
  };
  return hitToBaseMeta(fakeHit as ReturnType<typeof detectLongBase>);
}

function baseMetaFromScanO7(scanRow: NonNullable<ResolveBaseMetaInput["scanRow"]>): ChartSetupBaseMeta {
  const line =
    scanRow.summaryLines?.find((l) => /base|consolidat|coil|box/i.test(l)) ??
    "Ticker Review flagged tight base — multi-week consolidation structure on the daily chart";

  return {
    detected: true,
    stage: "forming",
    gapDate: null,
    gapPct: null,
    baseDays: null,
    baseRangePct: null,
    ceiling: null,
    floor: null,
    volContracting: false,
    confidence: 55,
    summaryLines: [line],
    longSetupPositives: ["Scan: Tight base (O7) criteria fired"],
  };
}

function apply200dContext(meta: ChartSetupBaseMeta, input: ResolveBaseMetaInput): ChartSetupBaseMeta {
  if (!meta.detected || !input.dailyCandles?.length) return meta;

  const bars = toSetupBars(input.dailyCandles);
  const ctx = analyzeBase200dContext(
    bars,
    input.sma200Series,
    meta.consolidationDays ?? meta.baseDays,
    input.lastSessionPct,
    { pctVs200Now: input.pctVs200, pctVs50Now: input.pctVs50 }
  );

  if (!ctx.baseBelow200d && !ctx.reclaim.active && !ctx.powerSetup) return meta;

  const summaryLines = [...meta.summaryLines];
  const longSetupPositives = [...meta.longSetupPositives];

  for (const line of ctx.summaryLines) {
    if (!summaryLines.includes(line)) summaryLines.push(line);
  }
  for (const line of ctx.longSetupPositives) {
    if (!longSetupPositives.includes(line)) longSetupPositives.push(line);
  }

  if (ctx.powerSetup && summaryLines.length > 1) {
    const powerLine = summaryLines.find((l) => l.startsWith("Power setup:"));
    if (powerLine) {
      const rest = summaryLines.filter((l) => l !== powerLine);
      summaryLines.length = 0;
      summaryLines.push(powerLine, ...rest);
    }
  }

  return {
    ...meta,
    baseBelow200d: ctx.baseBelow200d,
    reclaim200d: ctx.reclaim,
    powerSetup: ctx.powerSetup,
    summaryLines: summaryLines.slice(0, 5),
    longSetupPositives: longSetupPositives.slice(0, 5),
    stage:
      ctx.powerSetup || ctx.reclaim.justOnLastBar
        ? "triggered"
        : meta.stage,
  };
}

function rankBaseHit(hit: SetupDetectionResult): number {
  if (!hit.detected) return -1;
  const d = hit.diagnostics ?? {};
  const days = typeof d.baseDays === "number" ? d.baseDays : 0;
  const range =
    typeof d.baseRangePct === "string"
      ? parseFloat(d.baseRangePct)
      : typeof d.baseRangePct === "number"
        ? d.baseRangePct
        : 20;
  let score = hit.confidence;
  if (d.anchor === "recent_coil") score += 38;
  if (days > 75) score -= (days - 75) * 0.6;
  if (range > 12) score -= (range - 12) * 3;
  if (days >= 18 && days <= 55 && range <= 10) score += 22;
  return score;
}

function pickBestBaseHit(bars: SetupBar[]): SetupDetectionResult {
  const candidates = [
    detectRecentCoilBase(bars),
    detectLongBase(bars),
    detectTightConsolidationBase(bars),
  ].filter((h) => h.detected);

  if (!candidates.length) return detectLongBase(bars);

  let best = candidates[0]!;
  let bestScore = rankBaseHit(best);
  for (const c of candidates.slice(1)) {
    const s = rankBaseHit(c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

export function computeChartSetupBaseMeta(
  dailyCandles: unknown[] | undefined
): ChartSetupBaseMeta {
  if (!dailyCandles?.length) return emptyBaseMeta();

  const bars = toSetupBars(dailyCandles);
  if (bars.length < 17) return emptyBaseMeta();

  const hit = pickBestBaseHit(bars);
  if (!hit.detected) return emptyBaseMeta();

  return hitToBaseMeta(hit);
}

/** Primary entry: bars + optional scan row fallbacks. */
export function resolveChartSetupBaseMeta(input: ResolveBaseMetaInput): ChartSetupBaseMeta {
  let meta = computeChartSetupBaseMeta(input.dailyCandles);

  if (!meta.detected && input.scanRow?.patternHits?.length) {
    const longBaseHit = input.scanRow.patternHits.find(
      (h) => h.pattern === "long_base" || h.criterionId === "O7"
    );
    if (longBaseHit) {
      const fromScan = baseMetaFromPatternHit(longBaseHit);
      if (fromScan) meta = fromScan;
    }
  }

  if (!meta.detected && input.scanRow?.firedOptional?.includes("O7")) {
    meta = baseMetaFromScanO7(input.scanRow);
  }

  if (
    input.pctVs20 != null &&
    input.pctVs20 > 0 &&
    input.pctVs50 != null &&
    input.pctVs50 > 0 &&
    input.pctVs200 != null &&
    input.pctVs200 > 0
  ) {
    const stackLine = "Price above 20d/50d/200d — healthy MA stack under the base";
    if (!meta.longSetupPositives.includes(stackLine)) {
      meta = {
        ...meta,
        longSetupPositives: [stackLine, ...meta.longSetupPositives].slice(0, 5),
      };
    }
  }

  return apply200dContext(meta, input);
}
