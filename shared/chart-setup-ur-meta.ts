import type { SetupStage } from "./setup-detectors/types";
import { detectBestUndercutRally } from "./setup-detectors/ur";
import { normalizeSetupBars, sortBarsChronological } from "./setup-detectors/bars";
import { analyzeLastBarSession } from "./chart-setup-session-bar";

export interface ChartSetupUrMeta {
  detected: boolean;
  stage: SetupStage | null;
  maLabel: string | null;
  undercutDepthPct: number | null;
  barsBelow: number | null;
  undercutLow: number | null;
  reclaimOnLastBar: boolean;
  buyableNow: boolean;
  confidence: number | null;
  summaryLines: string[];
  longSetupPositives: string[];
}

function emptyUrMeta(): ChartSetupUrMeta {
  return {
    detected: false,
    stage: null,
    maLabel: null,
    undercutDepthPct: null,
    barsBelow: null,
    undercutLow: null,
    reclaimOnLastBar: false,
    buyableNow: false,
    confidence: null,
    summaryLines: [],
    longSetupPositives: [],
  };
}

function hitToUrMeta(
  hit: ReturnType<typeof detectBestUndercutRally>,
  bars?: ReturnType<typeof normalizeSetupBars>
): ChartSetupUrMeta {
  const d = hit.diagnostics ?? {};
  const ma =
    typeof d.maLabel === "string"
      ? d.maLabel
      : d.maPeriod != null
        ? `${d.maPeriod} ${d.maType === "ema" ? "EMA" : "SMA"}`
        : null;
  const depthRaw = d.undercutDepthPct;
  const depth =
    typeof depthRaw === "string"
      ? parseFloat(depthRaw)
      : typeof depthRaw === "number"
        ? depthRaw
        : null;
  const barsBelow = typeof d.barsBelow === "number" ? d.barsBelow : null;
  const reclaimOnLastBar = d.reclaimOnLastBar === true;
  const buyableNow = d.buyableNow === true || (reclaimOnLastBar && hit.stage === "triggered");
  const undercutLow = hit.stop;

  const summaryLines: string[] = [];
  const longSetupPositives: string[] = [];

  if (ma && depth != null && barsBelow != null) {
    if (buyableNow) {
      summaryLines.push(
        `${ma} U&R — short pullback undercut (${depth.toFixed(1)}% / ${barsBelow}d below) and reclaimed on last bar — buyable now`
      );
      longSetupPositives.push(`${ma} undercut-and-rally — actionable reclaim`);
    } else {
      summaryLines.push(
        `${ma} U&R — ${depth.toFixed(1)}% undercut (${barsBelow}d below), rally stage ${hit.stage}`
      );
      longSetupPositives.push(`${ma} U&R pattern detected`);
    }
  }

  if (undercutLow != null && Number.isFinite(undercutLow)) {
    summaryLines.push(`Undercut low $${undercutLow.toFixed(2)} — invalidation reference`);
  }

  return {
    detected: true,
    stage: hit.stage,
    maLabel: ma,
    undercutDepthPct: depth,
    barsBelow,
    undercutLow,
    reclaimOnLastBar,
    buyableNow,
    confidence: hit.confidence,
    summaryLines: summaryLines.slice(0, 3),
    longSetupPositives: longSetupPositives.slice(0, 2),
  };
}

export function urMetaFromPatternHit(hit: {
  stage?: string;
  confidence?: number;
  stop?: number | null;
  diagnostics?: Record<string, unknown>;
}): ChartSetupUrMeta | null {
  const d = hit.diagnostics ?? {};
  if (d.anchor !== "last_bar_reclaim" && hit.stage == null && d.maPeriod == null) return null;

  const fakeHit = {
    detected: true,
    pattern: "undercut_rally" as const,
    criterionId: "O5" as const,
    stage: (hit.stage as SetupStage) ?? "forming",
    confidence: hit.confidence ?? 65,
    entry: null,
    stop: typeof hit.stop === "number" ? hit.stop : null,
    target: null,
    diagnostics: d,
  };
  return hitToUrMeta(fakeHit as ReturnType<typeof detectBestUndercutRally>);
}

export function resolveChartSetupUrMeta(input: {
  dailyCandles?: unknown[];
  sma21Series?: (number | null)[];
  sma50Series?: (number | null)[];
  scanRow?: {
    firedOptional?: string[];
    patternHits?: {
      pattern?: string;
      criterionId?: string;
      stage?: string;
      confidence?: number;
      stop?: number | null;
      diagnostics?: Record<string, unknown>;
    }[];
  } | null;
}): ChartSetupUrMeta {
  if (input.dailyCandles?.length) {
    const bars = sortBarsChronological(normalizeSetupBars(input.dailyCandles));
    if (bars.length >= 28) {
      const sma21 =
        input.sma21Series && input.sma21Series.length >= bars.length
          ? input.sma21Series.slice(-bars.length)
          : undefined;
      const sma50 =
        input.sma50Series && input.sma50Series.length >= bars.length
          ? input.sma50Series.slice(-bars.length)
          : undefined;
      const hit = detectBestUndercutRally(bars, {
        sma21Series: sma21,
        sma50Series: sma50,
      });
      if (hit.detected) return hitToUrMeta(hit, bars);
    }
  }

  const urHit = input.scanRow?.patternHits?.find(
    (h) => h.criterionId === "O5" || h.pattern === "undercut_rally"
  );
  if (urHit) {
    const fromScan = urMetaFromPatternHit(urHit);
    if (fromScan) return fromScan;
  }

  if (input.scanRow?.firedOptional?.includes("O5")) {
    return {
      detected: true,
      stage: "ready",
      maLabel: null,
      undercutDepthPct: null,
      barsBelow: null,
      undercutLow: null,
      reclaimOnLastBar: false,
      buyableNow: false,
      confidence: 55,
      summaryLines: ["U&R reclaim in play — price recovering key MAs after pullback"],
      longSetupPositives: ["Scan: U&R (O5) criteria fired"],
    };
  }

  return emptyUrMeta();
}
