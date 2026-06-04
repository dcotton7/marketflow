import { BARS_PER_DAY } from "@shared/indicatorTemplates";
import { calcBars, type ChartMaDataLimits, isMaRowFeasibleForTimeframe, getMaxBarsForTimeframe } from "@/lib/chart-ma-feasibility";
import type { StartHereInterval } from "@/components/MiniChart";

export interface MiniMaSettingRow {
  rowId: string;
  title: string;
  maType: string;
  period: number | null;
  color: string;
  lineType: number;
  isSystem: boolean;
  isVisible: boolean;
  dailyOn: boolean;
  fiveMinOn: boolean;
  fifteenMinOn: boolean;
  thirtyMinOn: boolean;
  sortOrder: number;
  calcOn: "daily" | "intraday";
}

export interface MiniChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MiniMaOverlay {
  dataKey: string;
  label: string;
  color: string;
  strokeWidth: number;
  strokeDasharray?: string;
  sessionAware?: boolean;
}

function sessionDateKeyEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function calculateSMA(data: { close: number }[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

function calculateEMA(data: { close: number }[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (prev === null) {
      if (i < period - 1) {
        ema.push(null);
        continue;
      }
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0);
      prev = sum / period;
      ema.push(prev);
    } else {
      prev = data[i].close * k + prev * (1 - k);
      ema.push(prev);
    }
  }
  return ema;
}

export function calculateSessionVwap(bars: MiniChartBar[]): (number | null)[] {
  let cumPv = 0;
  let cumVol = 0;
  let sessionKey: string | null = null;
  const out: (number | null)[] = [];
  for (const bar of bars) {
    const key = sessionDateKeyEt(bar.date);
    if (key !== sessionKey) {
      sessionKey = key;
      cumPv = 0;
      cumVol = 0;
    }
    const h = Number(bar.high);
    const l = Number(bar.low);
    const c = Number(bar.close);
    const v = Number(bar.volume);
    if (![h, l, c, v].every(Number.isFinite) || v <= 0) {
      out.push(cumVol > 0 ? cumPv / cumVol : null);
      continue;
    }
    const typical = (h + l + c) / 3;
    cumPv += typical * v;
    cumVol += v;
    out.push(cumVol > 0 ? cumPv / cumVol : null);
  }
  return out;
}

export function startHereIntervalToMaTimeframe(interval: StartHereInterval): string {
  if (interval === "1d") return "daily";
  if (interval === "5m") return "5m";
  if (interval === "30m") return "30m";
  return "15m";
}

/** Visible candle count per Start Here mini chart timeframe. */
export function startHereVisibleBars(interval: StartHereInterval): number {
  if (interval === "1d") return 50;
  if (interval === "5m") return 160;
  if (interval === "30m") return 100;
  return 120;
}

export function startHereIntervalChartLabel(interval: StartHereInterval): string {
  if (interval === "1d") return "Daily";
  if (interval === "5m") return "5 min";
  if (interval === "30m") return "30 min";
  return "15 min";
}

function timeframeToggleField(tf: string): keyof Pick<
  MiniMaSettingRow,
  "dailyOn" | "fiveMinOn" | "fifteenMinOn" | "thirtyMinOn"
> {
  if (tf === "daily") return "dailyOn";
  if (tf === "5m" || tf === "5min") return "fiveMinOn";
  if (tf === "15m" || tf === "15min") return "fifteenMinOn";
  if (tf === "30m" || tf === "30min") return "thirtyMinOn";
  return "thirtyMinOn";
}

function getEffectivePeriod(row: MiniMaSettingRow, timeframe: string): number | null {
  if (row.period == null) return null;
  if (row.calcOn === "intraday") return row.period;
  const bpd = BARS_PER_DAY[timeframe];
  if (bpd == null || bpd <= 0) return row.period;
  return Math.max(1, Math.round(row.period * bpd));
}

export function rechartsStrokeDasharray(lineType: number): string | undefined {
  switch (lineType) {
    case 1:
      return "5 5";
    case 2:
      return "2 2";
    case 3:
      return "8 4";
    case 4:
      return "2 6";
    default:
      return undefined;
  }
}

export function resolveMiniMaStrokeWidth(lineType: number): number {
  return lineType === 3 ? 2.25 : 1.75;
}

export function getActiveMiniMaRows(
  rows: MiniMaSettingRow[] | undefined,
  interval: StartHereInterval,
  limits: ChartMaDataLimits
): MiniMaSettingRow[] {
  if (!rows?.length) return [];
  const tf = startHereIntervalToMaTimeframe(interval);
  const toggle = timeframeToggleField(tf);
  return rows
    .filter((r) => r.isVisible !== false)
    .filter((r) => r[toggle])
    .filter((r) => isMaRowFeasibleForTimeframe(r, tf, limits))
    .filter((r) => r.maType === "vwap" || r.maType === "sma" || r.maType === "ema")
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function buildMiniMaOverlays(
  rows: MiniMaSettingRow[],
  interval: StartHereInterval,
  limits: ChartMaDataLimits
): MiniMaOverlay[] {
  return getActiveMiniMaRows(rows, interval, limits).map((row) => ({
    dataKey: `ma_${row.rowId}`,
    label: row.title,
    color: row.color,
    strokeWidth: resolveMiniMaStrokeWidth(row.lineType),
    strokeDasharray: rechartsStrokeDasharray(row.lineType),
    sessionAware: row.maType === "vwap",
  }));
}

export function applyMiniMaSeriesToChartData(
  bars: MiniChartBar[],
  rows: MiniMaSettingRow[],
  interval: StartHereInterval,
  limits: ChartMaDataLimits
): Array<MiniChartBar & Record<string, number | null>> {
  const active = getActiveMiniMaRows(rows, interval, limits);
  const tf = startHereIntervalToMaTimeframe(interval);
  const base = bars.map((b) => ({ ...b, color: b.close >= b.open ? "#22c55e" : "#ef4444" }));
  if (active.length === 0) return base;

  const seriesByKey: Record<string, (number | null)[]> = {};
  for (const row of active) {
    const key = `ma_${row.rowId}`;
    if (row.maType === "vwap") {
      seriesByKey[key] = calculateSessionVwap(bars);
      continue;
    }
    const period = getEffectivePeriod(row, tf);
    if (period == null || period < 1) {
      seriesByKey[key] = bars.map(() => null);
      continue;
    }
    seriesByKey[key] =
      row.maType === "ema" ? calculateEMA(bars, period) : calculateSMA(bars, period);
  }

  return base.map((item, index) => {
    const row: Record<string, number | null> = { ...item };
    for (const [key, series] of Object.entries(seriesByKey)) {
      const val = series[index];
      row[key] = val;
      const overlay = active.find((r) => `ma_${r.rowId}` === key);
      if (overlay?.maType === "vwap") {
        const prevKey = index > 0 ? sessionDateKeyEt(bars[index - 1].date) : sessionDateKeyEt(item.date);
        const curKey = sessionDateKeyEt(item.date);
        const sessionStart = index > 0 && curKey !== prevKey;
        row[`${key}_line`] = sessionStart ? null : val;
      }
    }
    return row;
  });
}

export function formatMiniMaLegend(
  rows: MiniMaSettingRow[],
  interval: StartHereInterval,
  limits: ChartMaDataLimits
): string {
  const active = getActiveMiniMaRows(rows, interval, limits);
  if (active.length === 0) return "No indicators";
  return active.map((r) => r.title).join(" · ");
}

export function getMiniMaLegendItems(
  rows: MiniMaSettingRow[],
  interval: StartHereInterval,
  limits: ChartMaDataLimits
): Array<{ title: string; color: string }> {
  return getActiveMiniMaRows(rows, interval, limits).map((r) => ({
    title: r.title,
    color: r.color,
  }));
}

export function miniMaCalcBarCount(
  visibleBars: number,
  rows: MiniMaSettingRow[],
  interval: StartHereInterval,
  limits: ChartMaDataLimits
): number {
  const tf = startHereIntervalToMaTimeframe(interval);
  const active = getActiveMiniMaRows(rows, interval, limits);
  let maxRequired = visibleBars;

  for (const row of active) {
    if (row.maType !== "sma" && row.maType !== "ema") continue;
    if (row.period == null) continue;
    const periodBars =
      row.calcOn === "intraday"
        ? row.period
        : calcBars(row.period, tf) ?? row.period;
    maxRequired = Math.max(maxRequired, periodBars + 5);
  }

  if (interval === "1d") {
    const maxDailyPeriod = rows
      .filter((r) => r.maType === "sma" || r.maType === "ema")
      .map((r) => r.period ?? 0)
      .reduce((m, p) => Math.max(m, p), 50);
    maxRequired = Math.max(maxRequired, visibleBars + maxDailyPeriod + 10);
    return Math.min(2000, maxRequired);
  }

  const cap = getMaxBarsForTimeframe(tf, limits);
  return Math.min(cap, maxRequired);
}
