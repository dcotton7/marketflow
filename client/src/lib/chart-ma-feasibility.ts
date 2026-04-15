import { BARS_PER_DAY } from "@shared/indicatorTemplates";

/** Aligns chart `timeframe` prop with keys used in Indicator Settings / data-limit math. */
export function chartTimeframeToFeasibilityKey(timeframe: string): "5m" | "15m" | "30m" | "daily" {
  const tf = (timeframe || "daily").toLowerCase().trim();
  if (tf === "5min" || tf === "5m") return "5m";
  if (tf === "15min" || tf === "15m") return "15m";
  if (tf === "30min" || tf === "30m" || tf === "60min" || tf === "1h") return "30m";
  return "daily";
}

export interface ChartMaDataLimits {
  dataLimitDaily: number;
  dataLimit5min: number;
  dataLimit15min: number;
  dataLimit30min: number;
}

export const DEFAULT_CHART_MA_LIMITS: ChartMaDataLimits = {
  dataLimitDaily: 750,
  dataLimit5min: 63,
  dataLimit15min: 126,
  dataLimit30min: 126,
};

export function calcBars(dayPeriod: number | null, timeframe: string): number | null {
  if (dayPeriod == null) return null;
  const bpd = BARS_PER_DAY[timeframe];
  if (bpd == null || bpd <= 0) return dayPeriod;
  return Math.max(1, Math.round(dayPeriod * bpd));
}

export function getMaxBarsForTimeframe(timeframe: string, limits: ChartMaDataLimits): number {
  const bpd = BARS_PER_DAY[timeframe] ?? 1;
  switch (timeframe) {
    case "5m":
    case "5min":
      return limits.dataLimit5min * bpd;
    case "15m":
    case "15min":
      return limits.dataLimit15min * bpd;
    case "30m":
    case "30min":
      return limits.dataLimit30min * bpd;
    default:
      return limits.dataLimitDaily;
  }
}

function isNonVwap(maType: string): boolean {
  return maType !== "vwap" && maType !== "vwap_hi" && maType !== "vwap_lo";
}

export interface MaFeasibilityRow {
  maType: string;
  period: number | null;
  calcOn?: "daily" | "intraday";
}

/** Matches Indicator Settings: greyed / “off” when required bars exceed provider lookback. */
export function isMaRowFeasibleForTimeframe(
  row: MaFeasibilityRow,
  timeframe: string,
  limits: ChartMaDataLimits
): boolean {
  if (!isNonVwap(row.maType) || row.period == null) return true;
  const requiredBars =
    row.calcOn === "intraday" ? row.period : calcBars(row.period, timeframe) ?? row.period;
  const maxBars = getMaxBarsForTimeframe(timeframe, limits);
  return requiredBars <= maxBars;
}
