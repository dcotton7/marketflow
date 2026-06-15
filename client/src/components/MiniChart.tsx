import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useStockHistory,
  stockHistoryIsIntradayInterval,
  STOCK_HISTORY_INTRADAY_REFETCH_MS,
} from "@/hooks/use-stocks";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Cell,
} from "recharts";
import { DEFAULT_CHART_MA_LIMITS, type ChartMaDataLimits } from "@/lib/chart-ma-feasibility";
import { resolveChartBackgroundColor, isMiniMaSettingsEnabled } from "@/lib/chart-preferences-shared";
import {
  applyMiniMaSeriesToChartData,
  buildMiniMaOverlays,
  getMiniMaLegendItems,
  miniMaCalcBarCount,
  startHereVisibleBars,
  startHereIntervalChartLabel,
  type MiniMaSettingRow,
} from "@/lib/mini-chart-indicators";
import {
  MINI_MA_SETTINGS_QUERY_KEY,
  fetchMiniMaSettings,
} from "@/lib/sentinel-ma-settings-api";
import { isTradePlanEnabled } from "@/lib/trade-plan-feature";
import { formatAtrx50maLine } from "@/lib/live-theme-charts";
// Cup and Handle detection removed - thumbnails just show candlesticks

export type StartHereInterval = "1d" | "5m" | "15m" | "30m";

export type MiniChartQuoteSummary = {
  changePct: number;
  lastPrice: number | null;
  dataUpdatedAt: number;
  historyInterval: string;
};

interface MiniChartProps {
  symbol: string;
  timeframe?: string;
  technicalSignal?: string;
  crossDirection?: string;
  chartPattern?: string;
  /** Daily 21 / 50 / 200 SMA overlay (e.g. Start Here chart preview). */
  movingAverages2150200?: boolean;
  /**
   * With `movingAverages2150200`: `1d` = daily + 50 SMA; `5m` = 6/20 EMA; `15m` = session DVWAP (dotted).
   */
  startHereInterval?: StartHereInterval;
  /** Stretch to parent height (resizable grid cells); chart area uses flex-1. */
  fillContainer?: boolean;
  /** Hide the under-chart % / price / timestamp row (e.g. when shown in widget header). */
  hideChangeFooter?: boolean;
  /** Fired when Start Here MA/VWAP metrics change; null while loading or no data. */
  onQuoteSummaryChange?: (summary: MiniChartQuoteSummary | null) => void;
  /** Optional horizontal trade-plan entry line for Start Here mini-charts. */
  entryPrice?: number | null;
  /** Color profile for entry line (portfolio charts use green). */
  /** Hide the on-chart ADR info box (e.g. when shown in a sibling panel). */
  hideInfoBox?: boolean;
  /** Volume histogram under the price pane (e.g. Ticker Review mini charts). */
  showVolume?: boolean;
  /** Fired when ADR-multiple vs 50 SMA is recomputed. */
  onAdrsFrom50Change?: (value: number | null) => void;
  /** Fired once when history load completes with no bars (for ETF fallback chains). */
  onNoData?: () => void;
  /** ETF structure flags for breakdown-watch merge (Live Theme Charts). */
  onEtfStructureChange?: (flags: MiniChartEtfStructure | null) => void;
  /**
   * Ticker Review / dense grids: use lightweight 6/20 EMA (5m) overlays instead of
   * full Indicator Settings MA math on thousands of intraday bars (avoids UI freeze).
   */
  preferLegacyIntradayOverlays?: boolean;
  /** Live Theme Charts: show left price scale on mini chart. */
  showLeftPriceScale?: boolean;
  priceScaleTickCount?: number;
}

export type MiniChartEtfStructure = {
  below50Sma: boolean;
  belowVwap: boolean;
  sessionRed: boolean;
};

type MiniChartOhlcPayload = {
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;
};

type MiniChartInfoSnapshot = {
  pctFromEntry: number | null;
  pctFrom200Dma: number | null;
  adrsFrom50: number | null;
};

/**
 * Recharts range-bar shape: OHLC body (open–close) plus vertical wick (high–low).
 * Maps wick extremes using the same price scale as the computed body rectangle.
 */
function MiniChartCandleShape(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  payload?: MiniChartOhlcPayload;
  fill?: string;
}) {
  const x = Number(props.x);
  const y = Number(props.y);
  const width = Number(props.width);
  const rawH = Number(props.height);
  const topPx = Math.min(y, y + rawH);
  const botPx = Math.max(y, y + rawH);
  const bodyHeightPx = Math.max(botPx - topPx, 1);
  const payload = props.payload;
  const fill = payload?.color ?? props.fill ?? "#94a3b8";
  if (!payload || ![payload.open, payload.high, payload.low, payload.close].every(Number.isFinite)) {
    return null;
  }
  const { open, high, low, close } = payload;
  const bodyTopPrice = Math.max(open, close);
  const bodyBotPrice = Math.min(open, close);
  const cx = x + width / 2;
  const priceBodySpan = bodyTopPrice - bodyBotPrice;

  let yHigh: number;
  let yLow: number;

  if (priceBodySpan < 1e-10) {
    const wickSpan = Math.max(high - low, 1e-9);
    const mapWick = (p: number) => topPx + ((high - p) / wickSpan) * bodyHeightPx;
    yHigh = mapWick(high);
    yLow = mapWick(low);
    const yMid = mapWick(open);
    return (
      <g>
        <line
          x1={cx}
          y1={yHigh}
          x2={cx}
          y2={yLow}
          stroke={fill}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x}
          y1={yMid}
          x2={x + width}
          y2={yMid}
          stroke={fill}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  const priceToY = (p: number) =>
    topPx + ((bodyTopPrice - p) / priceBodySpan) * (botPx - topPx);
  yHigh = priceToY(high);
  yLow = priceToY(low);

  return (
    <g>
      <line
        x1={cx}
        y1={yHigh}
        x2={cx}
        y2={yLow}
        stroke={fill}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <rect x={x} y={topPx} width={width} height={botPx - topPx} fill={fill} />
    </g>
  );
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

function calculateAtr(data: { high: number; low: number; close: number }[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let trSum = 0;
  const trWindow: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const cur = data[i];
    const prevClose = i > 0 ? data[i - 1].close : cur.close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose)
    );
    trWindow.push(tr);
    trSum += tr;
    if (trWindow.length > period) {
      trSum -= trWindow.shift() ?? 0;
    }
    out.push(trWindow.length === period ? trSum / period : null);
  }
  return out;
}

function MiniChartInfoBox({ info }: { info: MiniChartInfoSnapshot | null }) {
  if (!info) return null;
  const line = formatAtrx50maLine(info.adrsFrom50);
  const negative = info.adrsFrom50 != null && info.adrsFrom50 < 0;
  return (
    <div
      className={`pointer-events-none absolute bottom-6 right-1 z-30 rounded px-2 py-1 text-[10px] font-medium leading-tight ${
        negative
          ? "border border-red-400/25 bg-red-400/15 text-red-300"
          : "border border-green-400/25 bg-green-400/15 text-green-300"
      }`}
    >
      {line}
    </div>
  );
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

type VwapBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Cumulative session VWAP (typical price × volume); resets each ET session. */
function calculateSessionVwap(bars: VwapBar[]): (number | null)[] {
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
    const tp = (h + l + c) / 3;
    const v = Math.max(Number(bar.volume) || 0, 0);
    cumPv += tp * v;
    cumVol += v;
    out.push(cumVol > 0 ? cumPv / cumVol : null);
  }
  return out;
}

/** % change for the most recent session in the slice (last close vs that session’s first open). */
function sessionChangePct(bars: VwapBar[]): number {
  if (bars.length < 1) return 0;
  const lastKey = sessionDateKeyEt(bars[bars.length - 1].date);
  let i = bars.length - 1;
  while (i > 0 && sessionDateKeyEt(bars[i - 1].date) === lastKey) i--;
  const open = bars[i].open;
  const lastClose = bars[bars.length - 1].close;
  return open > 0 ? ((lastClose - open) / open) * 100 : 0;
}

/** Same % / last price logic as the Start Here MA + intraday branches (for header strip + optional footer). */
function computeStartHereQuoteSummary(
  history: VwapBar[],
  startHereInterval: StartHereInterval
): { changePct: number; lastPrice: number | null } | null {
  if (history.length < 1) return null;
  if (startHereInterval !== "1d") {
    const maxBars = startHereVisibleBars(startHereInterval);
    const sliced = history.slice(-Math.min(history.length, maxBars));
    const last = sliced[sliced.length - 1];
    return {
      changePct: sessionChangePct(sliced),
      lastPrice: last && Number.isFinite(last.close) ? last.close : null,
    };
  }
  const maViewDays = 50;
  const maCalcDays = Math.min(history.length, Math.max(maViewDays + 55, 60));
  const calcHistory = history.slice(-maCalcDays);
  const lastCandleMa = calcHistory[calcHistory.length - 1];
  const prevCandleMa = calcHistory[calcHistory.length - 2];
  const dailyChangeMa = prevCandleMa
    ? ((lastCandleMa.close - prevCandleMa.close) / prevCandleMa.close) * 100
    : 0;
  const lastPxMa = Number.isFinite(lastCandleMa.close) ? lastCandleMa.close : null;
  return { changePct: dailyChangeMa, lastPrice: lastPxMa };
}

function calculateEMA(data: { close: number }[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const sum = data.slice(0, period).reduce((acc, d) => acc + d.close, 0);
      ema.push(sum / period);
    } else {
      const prevEma = ema[i - 1];
      if (prevEma !== null) {
        ema.push((data[i].close - prevEma) * multiplier + prevEma);
      } else {
        ema.push(null);
      }
    }
  }
  return ema;
}

interface ConsolidationChannel {
  startDate: string;
  endDate: string;
  high: number;
  low: number;
  type: string;
}

function detectConsolidationChannels(
  data: { date: string; high: number; low: number; close: number; volume: number }[],
  patternTimeframe: string
): ConsolidationChannel[] {
  const channels: ConsolidationChannel[] = [];
  
  if (data.length < 5) return channels;
  
  if (patternTimeframe === '20D' || patternTimeframe === 'all') {
    const weeklyData = data.slice(-20);
    if (weeklyData.length >= 5) {
      const weeklyHigh = Math.max(...weeklyData.map(c => c.high));
      const weeklyLow = Math.min(...weeklyData.map(c => c.low));
      const avgPrice = weeklyData.reduce((sum, c) => sum + c.close, 0) / weeklyData.length;
      const rangePercent = ((weeklyHigh - weeklyLow) / avgPrice) * 100;
      
      if (rangePercent <= 12) {
        channels.push({
          startDate: weeklyData[0].date,
          endDate: weeklyData[weeklyData.length - 1].date,
          high: weeklyHigh,
          low: weeklyLow,
          type: 'Weekly Tight'
        });
      }
    }
  }
  
  if (patternTimeframe === '60D' || patternTimeframe === 'all') {
    if (data.length >= 20) {
      const monthlyData = data.slice(-60);
      if (monthlyData.length >= 20) {
        const monthlyHigh = Math.max(...monthlyData.map(c => c.high));
        const monthlyLow = Math.min(...monthlyData.map(c => c.low));
        const avgPrice = monthlyData.reduce((sum, c) => sum + c.close, 0) / monthlyData.length;
        const rangePercent = ((monthlyHigh - monthlyLow) / avgPrice) * 100;
        
        if (rangePercent <= 22 && !channels.some(c => c.type === 'Weekly Tight' && 
            Math.abs(c.high - monthlyHigh) < 1 && Math.abs(c.low - monthlyLow) < 1)) {
          channels.push({
            startDate: monthlyData[0].date,
            endDate: monthlyData[monthlyData.length - 1].date,
            high: monthlyHigh,
            low: monthlyLow,
            type: 'Monthly Tight'
          });
        }
      }
    }
  }
  
  if (patternTimeframe === '30D' || patternTimeframe === 'all') {
    if (data.length >= 30) {
      const vcpData = data.slice(-30);
      const period1 = vcpData.slice(0, 10);
      const period3 = vcpData.slice(20, 30);
      
      const getRange = (c: typeof period1) => {
        const maxHigh = Math.max(...c.map(x => x.high));
        const minLow = Math.min(...c.map(x => x.low));
        const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
        return (maxHigh - minLow) / avgPrice;
      };
      
      const range1 = getRange(period1);
      const range3 = getRange(period3);
      
      if (range3 < range1) {
        const vcpHigh = Math.max(...period3.map(c => c.high));
        const vcpLow = Math.min(...period3.map(c => c.low));
        
        channels.push({
          startDate: period3[0].date,
          endDate: period3[period3.length - 1].date,
          high: vcpHigh,
          low: vcpLow,
          type: 'VCP'
        });
      }
    }
  }
  
  return channels;
}

function formatMiniChartDataUpdatedAt(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

/** On-plot watermark: when data was last refreshed (not price — pricing stays in header/footer as configured). */
function MiniChartDataUpdatedBgLabel({
  dataUpdatedAt,
  historyInterval,
}: {
  dataUpdatedAt: number;
  historyInterval: string;
}) {
  if (dataUpdatedAt <= 0) return null;
  const isIntraday = stockHistoryIsIntradayInterval(historyInterval);
  const refreshHint = isIntraday
    ? `Intraday data refetches about every ${STOCK_HISTORY_INTRADAY_REFETCH_MS / 1000} seconds while this page is open.`
    : "Daily data does not auto-refresh; reload the page for newer bars.";
  const formatted = formatMiniChartDataUpdatedAt(dataUpdatedAt);
  return (
    <div
      className="pointer-events-none absolute bottom-1 right-1 z-10 max-w-[min(100%,12rem)] rounded border border-white/15 bg-black/50 px-1.5 py-0.5 text-center text-[9px] font-mono leading-tight text-white/85 shadow-sm backdrop-blur-sm"
      title={`Last data update · ${refreshHint}`}
    >
      {formatted}
    </div>
  );
}

function MiniChartVolumeStrip({
  data,
}: {
  data: Array<{ volume?: number; color?: string; open?: number; close?: number; date?: string }>;
}) {
  if (!data.length) return null;
  const volData = data.map((d) => {
    const vol = Math.max(Number(d.volume) || 0, 0);
    const up =
      d.color === "#22c55e" ||
      (d.open != null && d.close != null && Number.isFinite(d.open) && Number.isFinite(d.close) && d.close >= d.open);
    return {
      date: d.date,
      volume: vol,
      fill: up ? "rgba(34, 197, 94, 0.55)" : "rgba(239, 68, 68, 0.55)",
    };
  });

  return (
    <div
      className="h-[26%] min-h-[22px] max-h-[34px] w-full shrink-0 border-t border-white/10"
      aria-hidden
      data-testid="mini-chart-volume-strip"
    >
      <ResponsiveContainer width="100%" height="100%" debounce={50}>
        <BarChart data={volData} margin={{ top: 1, right: 6, left: 4, bottom: 0 }}>
          <XAxis hide dataKey="date" />
          <YAxis hide domain={[0, "auto"]} />
          <Bar dataKey="volume" isAnimationActive={false} radius={[1, 1, 0, 0]}>
            {volData.map((entry, i) => (
              <Cell key={`vol-${entry.date ?? i}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function miniChartPlotClass(fillContainer: boolean | undefined, showVolume: boolean | undefined) {
  const base = fillContainer ? "min-h-0 flex-1" : "h-[160px]";
  return showVolume ? `${base} flex flex-col` : base;
}

function miniChartPricePaneClass(showVolume: boolean | undefined) {
  return showVolume ? "relative min-h-0 w-full flex-1" : "relative w-full h-full";
}

function formatMiniPriceTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (abs < 10) return v.toFixed(2);
  return v.toFixed(0);
}

function miniChartPriceYAxis(
  domainMin: number,
  domainMax: number,
  showScale: boolean | undefined,
  tickCount = 4
) {
  if (!showScale) {
    return <YAxis domain={[domainMin, domainMax]} hide />;
  }
  return (
    <YAxis
      orientation="left"
      domain={[domainMin, domainMax]}
      width={36}
      tickCount={tickCount}
      axisLine={false}
      tickLine={false}
      tick={{ fontSize: 9, fill: "#94a3b8" }}
      tickFormatter={formatMiniPriceTick}
    />
  );
}

function miniChartMargin(showScale: boolean | undefined) {
  return { top: 8, right: 6, left: showScale ? 0 : 4, bottom: 4 };
}

export function formatMiniChartLastPrice(p: number): string {
  if (!Number.isFinite(p)) return "";
  const abs = Math.abs(p);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 4;
  return `$${p.toFixed(digits)}`;
}

function MiniChartChangeFooter({
  changePct,
  lastPrice,
  symbol,
  wrapperClassName,
}: {
  changePct: number;
  lastPrice: number | null;
  symbol: string;
  wrapperClassName: string;
}) {
  const priceLabel =
    lastPrice != null && Number.isFinite(lastPrice) ? formatMiniChartLastPrice(lastPrice) : null;
  return (
    <div className={wrapperClassName}>
      <span className="inline-flex flex-wrap items-baseline justify-center gap-x-2">
        <span
          className={`text-sm font-mono font-semibold ${changePct >= 0 ? "text-rs-green" : "text-rs-red"}`}
          data-testid={`change-${symbol}`}
        >
          {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
        {priceLabel ? (
          <span
            className="text-sm font-mono font-medium text-muted-foreground"
            data-testid={`last-price-${symbol}`}
          >
            {priceLabel}
          </span>
        ) : null}
      </span>
    </div>
  );
}

const MINI_MA_OVERLAY_CLASS =
  "pointer-events-none absolute left-2 top-1 z-10 rounded border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-white/95 shadow-sm backdrop-blur-sm";

function MiniMaLegendOverlay({
  intervalLabel,
  rows,
  interval,
  limits,
}: {
  intervalLabel: string;
  rows: MiniMaSettingRow[];
  interval: StartHereInterval;
  limits: ChartMaDataLimits;
}) {
  const items = getMiniMaLegendItems(rows, interval, limits);
  return (
    <div className={MINI_MA_OVERLAY_CLASS} aria-hidden>
      <span className="block">{intervalLabel}</span>
      <span className="block font-normal normal-case">
        {items.length === 0 ? (
          <span className="text-white/80">No indicators</span>
        ) : (
          items.map((item, idx) => (
            <span key={`${item.title}-${idx}`}>
              {idx > 0 ? <span className="text-white/50"> · </span> : null}
              <MaLegendTitle title={item.title} color={item.color} />
            </span>
          ))
        )}
      </span>
    </div>
  );
}

/** Label text with numeric MA period tinted to match the line color. */
function MaLegendTitle({ title, color }: { title: string; color: string }) {
  const match = title.match(/^(.*?)(\d[\d.]*(?:d|w|m)?)\s*$/i);
  if (!match) {
    return <span style={{ color }}>{title}</span>;
  }
  const [, prefix, num] = match;
  return (
    <span className="text-white/85">
      {prefix}
      <span style={{ color }}>{num}</span>
    </span>
  );
}

export function MiniChart({
  symbol,
  timeframe = '30D',
  technicalSignal,
  crossDirection,
  chartPattern,
  movingAverages2150200,
  startHereInterval = '1d',
  fillContainer,
  hideChangeFooter,
  hideInfoBox = false,
  showVolume = false,
  onQuoteSummaryChange,
  onAdrsFrom50Change,
  onNoData,
  onEtfStructureChange,
  entryPrice,
  entryLineTone = "default",
  preferLegacyIntradayOverlays = false,
  showLeftPriceScale = false,
  priceScaleTickCount = 4,
}: MiniChartProps) {
  const historyInterval = movingAverages2150200 ? startHereInterval : "1d";
  const { data: history, isLoading, error, dataUpdatedAt } = useStockHistory(
    symbol,
    historyInterval
  );
  const { data: dailyHistoryData } = useStockHistory(symbol, "1d");
  const noDataNotifiedKeyRef = useRef<string | null>(null);

  const useMiniMaProfile = Boolean(
    movingAverages2150200 &&
      isMiniMaSettingsEnabled() &&
      !preferLegacyIntradayOverlays
  );
  const { data: miniMaRows, isLoading: miniMaLoading } = useQuery<MiniMaSettingRow[]>({
    queryKey: MINI_MA_SETTINGS_QUERY_KEY,
    queryFn: fetchMiniMaSettings,
    enabled: useMiniMaProfile,
  });
  const { data: mainMaRows } = useQuery<MiniMaSettingRow[]>({
    queryKey: ["/api/sentinel/ma-settings"],
    enabled: useMiniMaProfile,
  });
  const effectiveMaRows = useMemo(() => {
    const source = miniMaRows?.length ? miniMaRows : mainMaRows;
    if (!source?.length) return [];
    if (miniMaRows?.length) return miniMaRows;
    return source.map((r) => ({
      ...r,
      thirtyMinOn: r.thirtyMinOn || r.fifteenMinOn,
    }));
  }, [miniMaRows, mainMaRows]);
  const { data: startHereChartPrefs } = useQuery<
    ChartMaDataLimits & { chartBackgroundColor?: string | null }
  >({
    queryKey: ["/api/sentinel/chart-preferences"],
    enabled: Boolean(movingAverages2150200),
  });
  const miniMaLimits: ChartMaDataLimits = useMemo(
    () => ({
      dataLimitDaily: startHereChartPrefs?.dataLimitDaily ?? DEFAULT_CHART_MA_LIMITS.dataLimitDaily,
      dataLimit5min: startHereChartPrefs?.dataLimit5min ?? DEFAULT_CHART_MA_LIMITS.dataLimit5min,
      dataLimit15min: startHereChartPrefs?.dataLimit15min ?? DEFAULT_CHART_MA_LIMITS.dataLimit15min,
      dataLimit30min: startHereChartPrefs?.dataLimit30min ?? DEFAULT_CHART_MA_LIMITS.dataLimit30min,
    }),
    [startHereChartPrefs]
  );
  const startHereChartBg = resolveChartBackgroundColor(startHereChartPrefs?.chartBackgroundColor);

  useEffect(() => {
    if (!onQuoteSummaryChange || !movingAverages2150200) return;
    if (isLoading || error || !history?.length) {
      onQuoteSummaryChange(null);
      return;
    }
    const s = computeStartHereQuoteSummary(history, startHereInterval);
    if (!s) {
      onQuoteSummaryChange(null);
      return;
    }
    onQuoteSummaryChange({
      ...s,
      dataUpdatedAt,
      historyInterval,
    });
  }, [
    onQuoteSummaryChange,
    movingAverages2150200,
    isLoading,
    error,
    history,
    startHereInterval,
    dataUpdatedAt,
    historyInterval,
  ]);

  const loadingShell = fillContainer
    ? "flex min-h-[120px] w-full flex-1 items-center justify-center rounded-md bg-card/50"
    : "h-[180px] w-full flex items-center justify-center bg-card rounded-lg border border-border";
  const boundedEntryPrice =
    isTradePlanEnabled() &&
    entryPrice != null &&
    Number.isFinite(entryPrice) &&
    entryPrice > 0
      ? entryPrice
      : null;
  const entryStroke = entryLineTone === "portfolio" ? "#22c55e" : "#facc15";
  const entryGlow =
    entryLineTone === "portfolio" ? "rgba(34, 197, 94, 0.49)" : "rgba(253, 224, 71, 0.49)";
  const entryBadgeTextClass = entryLineTone === "portfolio" ? "text-emerald-300" : "text-yellow-300";
  const entryBadgeBorderClass =
    entryLineTone === "portfolio" ? "border-emerald-300/70" : "border-yellow-300/70";
  const entryBorderClass =
    entryLineTone === "portfolio" ? "border-emerald-300" : "border-yellow-300";
  const entryDotClass = entryLineTone === "portfolio" ? "bg-emerald-300" : "bg-yellow-300";
  const dailyHistory = historyInterval === "1d" ? history : dailyHistoryData;
  const infoSnapshot = useMemo<MiniChartInfoSnapshot | null>(() => {
    if (!history?.length || !dailyHistory?.length) return null;
    const current = history[history.length - 1]?.close;
    if (!Number.isFinite(current) || current <= 0) return null;
    const sma200 = calculateSMA(dailyHistory, 200);
    const sma50 = calculateSMA(dailyHistory, 50);
    const atr14 = calculateAtr(dailyHistory, 14);
    const i = dailyHistory.length - 1;
    const s200 = sma200[i];
    const s50 = sma50[i];
    const atr = atr14[i];
    return {
      pctFromEntry:
        boundedEntryPrice != null ? ((current - boundedEntryPrice) / boundedEntryPrice) * 100 : null,
      pctFrom200Dma: s200 != null && s200 > 0 ? ((current - s200) / s200) * 100 : null,
      adrsFrom50: s50 != null && atr != null && atr > 0 ? (current - s50) / atr : null,
    };
  }, [history, dailyHistory, boundedEntryPrice]);

  const etfStructure = useMemo<MiniChartEtfStructure | null>(() => {
    if (!history?.length) return null;
    const below50Sma = infoSnapshot?.adrsFrom50 != null && infoSnapshot.adrsFrom50 < 0;
    if (startHereInterval !== "1d") {
      const maxBars = startHereVisibleBars(startHereInterval);
      const sliced = history.slice(-Math.min(history.length, maxBars));
      const changePct = sessionChangePct(sliced);
      const vwapSeries = calculateSessionVwap(sliced);
      const lastClose = sliced[sliced.length - 1]?.close;
      const lastVwap = vwapSeries[vwapSeries.length - 1];
      const belowVwap =
        lastVwap != null && Number.isFinite(lastClose) && lastClose < lastVwap;
      return { below50Sma, belowVwap, sessionRed: changePct < 0 };
    }
    const quote = computeStartHereQuoteSummary(history, startHereInterval);
    return {
      below50Sma,
      belowVwap: false,
      sessionRed: (quote?.changePct ?? 0) < 0,
    };
  }, [history, startHereInterval, infoSnapshot?.adrsFrom50]);

  useEffect(() => {
    onEtfStructureChange?.(etfStructure);
  }, [etfStructure, onEtfStructureChange]);

  useEffect(() => {
    onAdrsFrom50Change?.(infoSnapshot?.adrsFrom50 ?? null);
  }, [infoSnapshot?.adrsFrom50, onAdrsFrom50Change]);

  useEffect(() => {
    noDataNotifiedKeyRef.current = null;
  }, [symbol, historyInterval]);

  useEffect(() => {
    if (!onNoData || isLoading) return;
    const attemptKey = `${symbol}:${historyInterval}`;
    if (noDataNotifiedKeyRef.current === attemptKey) return;
    if (error || !history || history.length === 0) {
      noDataNotifiedKeyRef.current = attemptKey;
      onNoData();
    }
  }, [onNoData, isLoading, error, history, symbol, historyInterval]);

  const infoForRender = movingAverages2150200 && !hideInfoBox ? infoSnapshot : null;

  const configuredMaBundle = useMemo(() => {
    if (!useMiniMaProfile || !history?.length) return null;

    const visibleBars = startHereVisibleBars(startHereInterval);
    const calcCount = miniMaCalcBarCount(visibleBars, effectiveMaRows, startHereInterval, miniMaLimits);
    const calcHistory = history.slice(-Math.min(history.length, calcCount));
    const fullMaData = applyMiniMaSeriesToChartData(
      calcHistory,
      effectiveMaRows,
      startHereInterval,
      miniMaLimits
    );
    const maChartData = fullMaData.slice(-Math.min(visibleBars, fullMaData.length));
    const overlays = buildMiniMaOverlays(effectiveMaRows, startHereInterval, miniMaLimits);

    let minP = Infinity;
    let maxP = -Infinity;
    for (const d of maChartData) {
      minP = Math.min(minP, d.low);
      maxP = Math.max(maxP, d.high);
      for (const o of overlays) {
        const key = o.sessionAware ? `${o.dataKey}_line` : o.dataKey;
        const v = d[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          minP = Math.min(minP, v);
          maxP = Math.max(maxP, v);
        }
      }
    }
    if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
      minP = 0;
      maxP = 1;
    }
    if (boundedEntryPrice != null) {
      minP = Math.min(minP, boundedEntryPrice);
      maxP = Math.max(maxP, boundedEntryPrice);
    }
    const pad = (maxP - minP) * 0.05 || 0.01;
    const domainMin = minP - pad;
    const domainMax = maxP + pad;
    const domainRange = Math.max(domainMax - domainMin, 0.0001);
    const entryLineTopPct =
      boundedEntryPrice != null
        ? ((domainMax - boundedEntryPrice) / domainRange) * 100
        : null;
    const quote = computeStartHereQuoteSummary(history, startHereInterval);

    return {
      maChartData,
      overlays,
      domainMin,
      domainMax,
      entryLineTopPct,
      changePct: quote?.changePct ?? 0,
      lastPx: quote?.lastPrice ?? null,
      intervalLabel: startHereIntervalChartLabel(startHereInterval),
    };
  }, [
    useMiniMaProfile,
    history,
    effectiveMaRows,
    startHereInterval,
    miniMaLimits,
    boundedEntryPrice,
  ]);

  const legacyIntradayBundle = useMemo(() => {
    if (
      !movingAverages2150200 ||
      startHereInterval === "1d" ||
      useMiniMaProfile ||
      !history?.length
    ) {
      return null;
    }

    const maxBars = startHereVisibleBars(startHereInterval);
    const sliced = history.slice(-Math.min(history.length, maxBars));
    const is5m = startHereInterval === "5m";
    const intradayTitle = startHereIntervalChartLabel(startHereInterval);

    let intraChartData: Array<
      Record<string, unknown> & {
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        color: string;
      }
    >;
    let minP: number;
    let maxP: number;

    if (is5m) {
      const ema6Series = calculateEMA(sliced, 6);
      const ema20Series = calculateEMA(sliced, 20);
      intraChartData = sliced.map((item, index) => ({
        ...item,
        color: item.close >= item.open ? "#22c55e" : "#ef4444",
        ema6: ema6Series[index],
        ema20: ema20Series[index],
      }));
      let minV = Infinity;
      let maxV = -Infinity;
      for (const d of intraChartData) {
        minV = Math.min(minV, d.high, d.low);
        maxV = Math.max(maxV, d.high, d.low);
        const e6 = d.ema6;
        const e20 = d.ema20;
        if (typeof e6 === "number" && Number.isFinite(e6)) {
          minV = Math.min(minV, e6);
          maxV = Math.max(maxV, e6);
        }
        if (typeof e20 === "number" && Number.isFinite(e20)) {
          minV = Math.min(minV, e20);
          maxV = Math.max(maxV, e20);
        }
      }
      minP = minV;
      maxP = maxV;
    } else {
      const vwapSeries = calculateSessionVwap(sliced);
      intraChartData = sliced.map((item, index) => {
        const key = sessionDateKeyEt(item.date);
        const prevKey = index > 0 ? sessionDateKeyEt(sliced[index - 1].date) : key;
        const sessionStart = index > 0 && key !== prevKey;
        return {
          ...item,
          color: item.close >= item.open ? "#22c55e" : "#ef4444",
          vwap: vwapSeries[index],
          vwapLine: sessionStart ? null : vwapSeries[index],
        };
      });
      let minV = Infinity;
      let maxV = -Infinity;
      for (const d of intraChartData) {
        minV = Math.min(minV, d.high, d.low);
        maxV = Math.max(maxV, d.high, d.low);
      }
      for (const v of vwapSeries) {
        if (v != null && Number.isFinite(v)) {
          minV = Math.min(minV, v);
          maxV = Math.max(maxV, v);
        }
      }
      minP = minV;
      maxP = maxV;
    }

    if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
      minP = 0;
      maxP = 1;
    }
    if (boundedEntryPrice != null) {
      minP = Math.min(minP, boundedEntryPrice);
      maxP = Math.max(maxP, boundedEntryPrice);
    }
    const pad = (maxP - minP) * 0.05 || 0.01;
    const domainMinIv = minP - pad;
    const domainMaxIv = maxP + pad;
    const domainRangeIv = Math.max(domainMaxIv - domainMinIv, 0.0001);
    const entryLineTopPctIv =
      boundedEntryPrice != null
        ? ((domainMaxIv - boundedEntryPrice) / domainRangeIv) * 100
        : null;
    const changePct = sessionChangePct(sliced);
    const lastPx =
      sliced.length > 0 && Number.isFinite(sliced[sliced.length - 1].close)
        ? sliced[sliced.length - 1].close
        : null;

    return {
      is5m,
      intradayTitle,
      intraChartData,
      domainMinIv,
      domainMaxIv,
      entryLineTopPctIv,
      changePct,
      lastPx,
    };
  }, [
    movingAverages2150200,
    startHereInterval,
    useMiniMaProfile,
    history,
    boundedEntryPrice,
  ]);

  if (isLoading) {
    return (
      <div className={loadingShell} data-testid={`chart-loading-${symbol}`}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !history || history.length === 0) {
    return (
      <div
        className={`${loadingShell} text-muted-foreground text-sm`}
        data-testid={`chart-error-${symbol}`}
      >
        No data
      </div>
    );
  }

  if (useMiniMaProfile && miniMaLoading && effectiveMaRows.length === 0) {
    return (
      <div className={loadingShell} data-testid={`chart-loading-${symbol}`}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (useMiniMaProfile && configuredMaBundle) {
    const {
      maChartData,
      overlays,
      domainMin,
      domainMax,
      entryLineTopPct,
      changePct,
      lastPx,
      intervalLabel,
    } = configuredMaBundle;

    const outerCls = fillContainer
      ? "flex h-full w-full min-h-0 flex-1 flex-col bg-transparent p-1"
      : "w-full bg-card rounded-lg border border-border p-2";
    const plotCls = miniChartPlotClass(fillContainer, showVolume);
    const pricePaneCls = miniChartPricePaneClass(showVolume);

    return (
      <div className={outerCls} data-testid={`chart-${symbol}`}>
        <div className={`${plotCls}`} style={{ backgroundColor: startHereChartBg }}>
          <div className={pricePaneCls}>
          <MiniMaLegendOverlay
            intervalLabel={intervalLabel}
            rows={effectiveMaRows}
            interval={startHereInterval}
            limits={miniMaLimits}
          />
          <ResponsiveContainer
            width="100%"
            height="100%"
            minHeight={fillContainer ? 160 : undefined}
            debounce={50}
          >
            <ComposedChart data={maChartData} margin={miniChartMargin(showLeftPriceScale)}>
              <XAxis dataKey="date" hide />
              {miniChartPriceYAxis(domainMin, domainMax, showLeftPriceScale, priceScaleTickCount)}
              <Bar
                dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
                shape={MiniChartCandleShape}
                isAnimationActive={false}
              />
              {overlays.map((o) => (
                <Line
                  key={o.dataKey}
                  type="monotone"
                  dataKey={o.sessionAware ? `${o.dataKey}_line` : o.dataKey}
                  stroke={o.color}
                  strokeWidth={o.strokeWidth}
                  strokeDasharray={o.strokeDasharray}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
              {boundedEntryPrice != null ? (
                <ReferenceLine
                  y={boundedEntryPrice}
                  stroke={entryStroke}
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
          {boundedEntryPrice != null && entryLineTopPct != null ? (
            <div
              className="pointer-events-none absolute inset-x-[6px] z-40"
              style={{ top: `${Math.min(94, Math.max(8, entryLineTopPct))}%` }}
              data-testid={`mini-chart-entry-line-${symbol}`}
            >
              <div
                className={`relative border-t-[4px] border-solid ${entryBorderClass}`}
                style={{ boxShadow: `0 0 6px ${entryGlow}` }}
              >
                <span
                  className={`absolute -top-1.5 left-0 h-2.5 w-2.5 rounded-full ${entryDotClass}`}
                  style={{ boxShadow: `0 0 6px ${entryGlow}` }}
                />
                <span
                  className={`absolute top-1 right-0 rounded border ${entryBadgeBorderClass} bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold ${entryBadgeTextClass}`}
                  style={{ boxShadow: `0 0 6px ${entryGlow}` }}
                >
                  Entry {boundedEntryPrice.toFixed(2)}
                </span>
              </div>
            </div>
          ) : null}
          <MiniChartInfoBox info={infoForRender} />
          <MiniChartDataUpdatedBgLabel dataUpdatedAt={dataUpdatedAt} historyInterval={historyInterval} />
          </div>
          {showVolume ? <MiniChartVolumeStrip data={maChartData} /> : null}
        </div>
        {!hideChangeFooter ? (
          <MiniChartChangeFooter
            changePct={changePct}
            lastPrice={lastPx}
            symbol={symbol}
            wrapperClassName={`text-center ${fillContainer ? "flex-shrink-0 pt-1" : "pt-1"}`}
          />
        ) : null}
      </div>
    );
  }

  if (legacyIntradayBundle) {
    const {
      is5m,
      intradayTitle,
      intraChartData,
      domainMinIv,
      domainMaxIv,
      entryLineTopPctIv,
      changePct,
      lastPx,
    } = legacyIntradayBundle;

    const outerIv = fillContainer
      ? "flex h-full w-full min-h-0 flex-1 flex-col bg-transparent p-1"
      : "w-full bg-card rounded-lg border border-border p-2";
    const plotIv = miniChartPlotClass(fillContainer, showVolume);
    const pricePaneIv = miniChartPricePaneClass(showVolume);

    return (
      <div className={outerIv} data-testid={`chart-${symbol}`}>
        <div className={plotIv} style={{ backgroundColor: startHereChartBg }}>
          <div className={pricePaneIv}>
          <div
            className="pointer-events-none absolute left-2 top-1 z-10 rounded border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-white/95 shadow-sm backdrop-blur-sm"
            aria-hidden
          >
            <span className="block">{intradayTitle}</span>
            <span className="block font-normal normal-case text-white/80">
              {is5m ? '6 EMA (green) · 20 EMA (pink)' : 'Session DVWAP · yellow-orange dotted · ET'}
            </span>
          </div>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minHeight={fillContainer ? 160 : undefined}
            debounce={50}
          >
            <ComposedChart data={intraChartData} margin={miniChartMargin(showLeftPriceScale)}>
              <XAxis dataKey="date" hide />
              {miniChartPriceYAxis(domainMinIv, domainMaxIv, showLeftPriceScale, priceScaleTickCount)}
              <Bar
                dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
                shape={MiniChartCandleShape}
                isAnimationActive={false}
              />
              {is5m ? (
                <>
                  <Line
                    type="monotone"
                    dataKey="ema6"
                    stroke="#22c55e"
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ema20"
                    stroke="#f472b6"
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </>
              ) : (
                <Line
                  type="monotone"
                  dataKey="vwapLine"
                  stroke="#f5b014"
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
              {boundedEntryPrice != null ? (
                <ReferenceLine
                  y={boundedEntryPrice}
                  stroke={entryStroke}
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
          {boundedEntryPrice != null && entryLineTopPctIv != null ? (
            <div
              className="pointer-events-none absolute inset-x-[6px] z-40"
              style={{ top: `${Math.min(94, Math.max(8, entryLineTopPctIv))}%` }}
              data-testid={`mini-chart-entry-line-${symbol}`}
            >
              <div
                className={`relative border-t-[4px] border-solid ${entryBorderClass}`}
                style={{ boxShadow: `0 0 6px ${entryGlow}` }}
              >
                <span
                  className={`absolute -top-1.5 left-0 h-2.5 w-2.5 rounded-full ${entryDotClass}`}
                  style={{ boxShadow: `0 0 6px ${entryGlow}` }}
                />
                <span
                  className={`absolute top-1 right-0 rounded border ${entryBadgeBorderClass} bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold ${entryBadgeTextClass}`}
                  style={{ boxShadow: `0 0 6px ${entryGlow}` }}
                >
                  Entry {boundedEntryPrice.toFixed(2)}
                </span>
              </div>
            </div>
          ) : null}
          <MiniChartInfoBox info={infoForRender} />
          <MiniChartDataUpdatedBgLabel dataUpdatedAt={dataUpdatedAt} historyInterval={historyInterval} />
          </div>
          {showVolume ? <MiniChartVolumeStrip data={intraChartData} /> : null}
        </div>
        {!hideChangeFooter ? (
          <MiniChartChangeFooter
            changePct={changePct}
            lastPrice={lastPx}
            symbol={symbol}
            wrapperClassName={`text-center ${fillContainer ? "flex-shrink-0 pt-1" : "pt-1"}`}
          />
        ) : null}
      </div>
    );
  }

  if (movingAverages2150200 && startHereInterval === '1d' && !useMiniMaProfile) {
    /** Visible daily bars; extra history so 50 SMA is defined on the left edge of the window. */
    const maViewDays = 50;
    const maCalcDays = Math.min(history.length, Math.max(maViewDays + 55, 60));
    const calcHistory = history.slice(-maCalcDays);
    const sma50Series = calculateSMA(calcHistory, 50);
    const fullMaData = calcHistory.map((item, index) => ({
      ...item,
      color: item.close >= item.open ? "#22c55e" : "#ef4444",
      sma50d: sma50Series[index],
    }));
    const maChartData = fullMaData.slice(-Math.min(maViewDays, fullMaData.length));
    const allPricesMa = maChartData.flatMap((d) => [d.high, d.low]);
    let minPriceMa = Math.min(...allPricesMa);
    let maxPriceMa = Math.max(...allPricesMa);
    for (const d of maChartData) {
      const s = d.sma50d;
      if (s != null && Number.isFinite(s)) {
        minPriceMa = Math.min(minPriceMa, s);
        maxPriceMa = Math.max(maxPriceMa, s);
      }
    }
    if (boundedEntryPrice != null) {
      minPriceMa = Math.min(minPriceMa, boundedEntryPrice);
      maxPriceMa = Math.max(maxPriceMa, boundedEntryPrice);
    }
    if (!Number.isFinite(minPriceMa) || !Number.isFinite(maxPriceMa)) {
      minPriceMa = 0;
      maxPriceMa = 1;
    }
    const priceRangeMa = maxPriceMa - minPriceMa;
    const pricePaddingMa = priceRangeMa * 0.05;
    const domainMinMa = minPriceMa - pricePaddingMa;
    const domainMaxMa = maxPriceMa + pricePaddingMa;
    const domainRangeMa = Math.max(domainMaxMa - domainMinMa, 0.0001);
    const entryLineTopPctMa =
      boundedEntryPrice != null
        ? ((domainMaxMa - boundedEntryPrice) / domainRangeMa) * 100
        : null;
    const lastCandleMa = calcHistory[calcHistory.length - 1];
    const prevCandleMa = calcHistory[calcHistory.length - 2];
    const dailyChangeMa = prevCandleMa
      ? ((lastCandleMa.close - prevCandleMa.close) / prevCandleMa.close) * 100
      : 0;
    const lastPxMa = Number.isFinite(lastCandleMa.close) ? lastCandleMa.close : null;

    const outerMa = fillContainer
      ? "flex h-full w-full min-h-0 flex-1 flex-col bg-transparent p-1"
      : "w-full bg-card rounded-lg border border-border p-2";
    const plotMa = miniChartPlotClass(fillContainer, showVolume);
    const pricePaneMa = miniChartPricePaneClass(showVolume);

    return (
      <div className={outerMa} data-testid={`chart-${symbol}`}>
        <div className={plotMa} style={{ backgroundColor: startHereChartBg }}>
          <div className={pricePaneMa}>
          <div
            className="pointer-events-none absolute left-2 top-1 z-10 rounded border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-white/95 shadow-sm backdrop-blur-sm"
            aria-hidden
          >
            <span className="block">Daily</span>
            <span className="block font-normal normal-case text-white/80">
              Last {maViewDays} sessions · 50 SMA (red)
            </span>
          </div>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minHeight={fillContainer ? 160 : undefined}
            debounce={50}
          >
            <ComposedChart data={maChartData} margin={miniChartMargin(showLeftPriceScale)}>
              <XAxis dataKey="date" hide />
              {miniChartPriceYAxis(domainMinMa, domainMaxMa, showLeftPriceScale, priceScaleTickCount)}
              <Bar
                dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
                shape={MiniChartCandleShape}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="sma50d"
                stroke="#ef4444"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              {boundedEntryPrice != null ? (
                <ReferenceLine
                  y={boundedEntryPrice}
                  stroke={entryStroke}
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
          {boundedEntryPrice != null && entryLineTopPctMa != null ? (
            <div
              className="pointer-events-none absolute inset-x-[6px] z-40"
              style={{ top: `${Math.min(94, Math.max(8, entryLineTopPctMa))}%` }}
              data-testid={`mini-chart-entry-line-${symbol}`}
            >
              <div
                className={`relative border-t-[4px] border-solid ${entryBorderClass}`}
                style={{ boxShadow: `0 0 6px ${entryGlow}` }}
              >
                <span
                  className={`absolute -top-1.5 left-0 h-2.5 w-2.5 rounded-full ${entryDotClass}`}
                  style={{ boxShadow: `0 0 6px ${entryGlow}` }}
                />
                <span
                  className={`absolute top-1 right-0 rounded border ${entryBadgeBorderClass} bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold ${entryBadgeTextClass}`}
                  style={{ boxShadow: `0 0 6px ${entryGlow}` }}
                >
                  Entry {boundedEntryPrice.toFixed(2)}
                </span>
              </div>
            </div>
          ) : null}
          <MiniChartInfoBox info={infoForRender} />
          <MiniChartDataUpdatedBgLabel dataUpdatedAt={dataUpdatedAt} historyInterval={historyInterval} />
          </div>
          {showVolume ? <MiniChartVolumeStrip data={maChartData} /> : null}
        </div>
        {!hideChangeFooter ? (
          <MiniChartChangeFooter
            changePct={dailyChangeMa}
            lastPrice={lastPxMa}
            symbol={symbol}
            wrapperClassName={`text-center ${fillContainer ? "flex-shrink-0 pt-1" : "pt-1"}`}
          />
        ) : null}
      </div>
    );
  }

  // Determine indicator type based on signal/pattern
  const is620Cross = technicalSignal === '6_20_cross';
  const isRide21EMA = technicalSignal === 'ride_21_ema';
  const isPullback = technicalSignal?.startsWith('pullback_');
  const isMonthlyTight = chartPattern === 'Monthly Tight';
  const isCupAndHandle = chartPattern === 'Cup and Handle';
  const isPatternWithSMA21 = ['VCP', 'Weekly Tight', 'High Tight Flag'].includes(chartPattern || '');
  
  let displayDays = 90;
  let patternTimeframe = 'all';
  
  if (is620Cross) {
    displayDays = 60;
  } else if (isRide21EMA || isPullback) {
    displayDays = 90;
  } else if (isMonthlyTight) {
    displayDays = 120;
    patternTimeframe = '60D';
  } else if (isCupAndHandle) {
    displayDays = 130; // Show 6 months for cup and handle
    patternTimeframe = 'none'; // No channel overlay
  } else if (timeframe === '20D') {
    displayDays = 60;
    patternTimeframe = '20D';
  } else if (timeframe === '30D') {
    displayDays = 90;
    patternTimeframe = '30D';
  } else if (timeframe === '60D') {
    displayDays = 120;
    patternTimeframe = '60D';
  }

  const slicedHistory = history.slice(-displayDays);
  
  // No channels for Cup and Handle - we draw the cup arc instead
  const channels = (is620Cross || isRide21EMA || isPullback || isCupAndHandle) ? [] : detectConsolidationChannels(slicedHistory, patternTimeframe);
  
  // Cup and Handle: Skip detection and visualization for thumbnails
  // The cup overlay doesn't render properly at small thumbnail size
  // Full visualization is shown on the symbol detail chart instead
  
  // Calculate indicators based on signal type
  // Thumbnail indicators per spreadsheet:
  // - 6/20 Cross: SMA 6 Pink, SMA 20 Blue
  // - Ride 21 EMA: EMA 21 Pink only
  // - Pullback / VCP / Weekly Tight / High Tight Flag / Cup Handle: SMA 21 Pink
  // - Monthly Tight: 3 Month SMA (approx 63 trading days) Pink
  let sma6Values: (number | null)[] = [];
  let sma20Values: (number | null)[] = [];
  let sma21Values: (number | null)[] = [];
  let ema21Values: (number | null)[] = [];
  let sma3MonthValues: (number | null)[] = [];
  
  if (is620Cross) {
    sma6Values = calculateSMA(slicedHistory, 6);
    sma20Values = calculateSMA(slicedHistory, 20);
  } else if (isRide21EMA) {
    // Only show EMA 21 Pink on thumbnail
    ema21Values = calculateEMA(slicedHistory, 21);
  } else if (isMonthlyTight) {
    // 3 Month SMA = approximately 63 trading days
    sma3MonthValues = calculateSMA(slicedHistory, 63);
  } else {
    // Default: SMA 21 for pullbacks, patterns, etc.
    sma21Values = calculateSMA(slicedHistory, 21);
  }

  // Determine cross direction for shading
  const isCrossUp = crossDirection === 'up';
  const shadeFill = isCrossUp ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';

  const chartData = slicedHistory.map((item, index) => {
    const baseData: any = {
      ...item,
      color: item.close >= item.open ? "#22c55e" : "#ef4444",
    };
    
    if (is620Cross) {
      baseData.sma6 = sma6Values[index];
      baseData.sma20 = sma20Values[index];
      // Calculate area between SMAs for shading
      if (sma6Values[index] !== null && sma20Values[index] !== null) {
        baseData.areaTop = Math.max(sma6Values[index]!, sma20Values[index]!);
        baseData.areaBottom = Math.min(sma6Values[index]!, sma20Values[index]!);
      }
    } else if (isRide21EMA) {
      baseData.ema21 = ema21Values[index];
    } else if (isMonthlyTight) {
      baseData.sma3Month = sma3MonthValues[index];
    } else if (isCupAndHandle) {
      // No overlay data for cup and handle thumbnails - just show candlesticks
      // Full visualization is shown on symbol detail chart only
    } else if (isPatternWithSMA21) {
      baseData.sma21 = sma21Values[index];
    }
    
    return baseData;
  });

  const allPrices = slicedHistory.flatMap(d => [d.high, d.low]);
  const domainPrices = boundedEntryPrice != null ? [...allPrices, boundedEntryPrice] : allPrices;
  const minPrice = Math.min(...domainPrices);
  const maxPrice = Math.max(...domainPrices);
  const priceRange = maxPrice - minPrice;
  const pricePadding = Math.max(priceRange * 0.05, maxPrice * 0.01, 0.25);
  const chartDomainMin = minPrice - pricePadding;
  const chartDomainMax = maxPrice + pricePadding;
  const chartDomainRange = Math.max(chartDomainMax - chartDomainMin, 0.0001);
  const entryLineTopPct =
    boundedEntryPrice != null
      ? ((chartDomainMax - boundedEntryPrice) / chartDomainRange) * 100
      : null;
  
  const lastCandle = slicedHistory[slicedHistory.length - 1];
  const prevCandle = slicedHistory[slicedHistory.length - 2];
  const dailyChange = prevCandle ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0;
  const lastPxDefault = Number.isFinite(lastCandle.close) ? lastCandle.close : null;

  return (
    <div 
      className="w-full bg-card rounded-lg border border-border p-2"
      data-testid={`chart-${symbol}`}
    >
      <div className="relative h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <XAxis dataKey="date" hide />
            <YAxis 
              domain={[chartDomainMin, chartDomainMax]}
              hide
            />

            {/* Channel overlays for pattern detection */}
            {channels.map((channel, index) => (
              <ReferenceArea
                key={`channel-${index}`}
                x1={channel.startDate}
                x2={channel.endDate}
                y1={channel.low}
                y2={channel.high}
                fill="#86efac"
                fillOpacity={0.4}
                stroke="#000000"
                strokeWidth={2}
              />
            ))}
            
            {/* 6/20 Cross: Shaded area between SMAs */}
            {is620Cross && (
              <Area
                type="monotone"
                dataKey="areaTop"
                stroke="none"
                fill={shadeFill}
                baseLine={chartData.map(d => d.areaBottom)}
                isAnimationActive={false}
              />
            )}
            
            {/* Candlestick bars (OHLC wicks + open–close body) */}
            <Bar
              dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
              shape={MiniChartCandleShape}
              isAnimationActive={false}
            />
            
            {/* 6/20 Cross indicators */}
            {is620Cross && (
              <>
                <Line
                  type="monotone"
                  dataKey="sma6"
                  stroke="#f472b6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="sma20"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </>
            )}
            
            {/* Ride 21 EMA: Only EMA 21 Pink on thumbnail */}
            {isRide21EMA && (
              <Line
                type="monotone"
                dataKey="ema21"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            
            {/* Monthly Tight: 3 Month SMA Pink */}
            {isMonthlyTight && (
              <Line
                type="monotone"
                dataKey="sma3Month"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            
            {/* Cup and Handle: No overlay on thumbnails - they don't render properly at small size */}
            {/* The full chart visualization works correctly, thumbnails just show the candlesticks */}
            
            {/* Default: SMA 21 for pullbacks, patterns (VCP, Weekly Tight, High Tight Flag) */}
            {!is620Cross && !isRide21EMA && !isMonthlyTight && !isCupAndHandle && isPatternWithSMA21 && (
              <Line
                type="monotone"
                dataKey="sma21"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            {boundedEntryPrice != null ? (
              <ReferenceLine
                y={boundedEntryPrice}
                stroke={entryStroke}
                strokeWidth={2.5}
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{
                  value: `Entry ${boundedEntryPrice.toFixed(2)}`,
                  position: "insideTopRight",
                  fill: entryStroke,
                  fontSize: 10,
                  fontWeight: 700,
                }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
        {boundedEntryPrice != null && entryLineTopPct != null ? (
          <div
            className="pointer-events-none absolute inset-x-[6px] z-40"
            style={{ top: `${Math.min(94, Math.max(8, entryLineTopPct))}%` }}
            data-testid={`mini-chart-entry-line-${symbol}`}
          >
            <div
              className={`relative border-t-[4px] border-solid ${entryBorderClass}`}
              style={{ boxShadow: `0 0 6px ${entryGlow}` }}
            >
              <span
                className={`absolute -top-1.5 left-0 h-2.5 w-2.5 rounded-full ${entryDotClass}`}
                style={{ boxShadow: `0 0 6px ${entryGlow}` }}
              />
              <span
                className={`absolute top-1 right-0 rounded border ${entryBadgeBorderClass} bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold ${entryBadgeTextClass}`}
                style={{ boxShadow: `0 0 6px ${entryGlow}` }}
              >
                Entry {boundedEntryPrice.toFixed(2)}
              </span>
            </div>
          </div>
        ) : null}
        <MiniChartInfoBox info={infoForRender} />
        <MiniChartDataUpdatedBgLabel dataUpdatedAt={dataUpdatedAt} historyInterval={historyInterval} />
      </div>
      {!hideChangeFooter ? (
        <MiniChartChangeFooter
          changePct={dailyChange}
          lastPrice={lastPxDefault}
          symbol={symbol}
          wrapperClassName="text-center pt-1"
        />
      ) : null}
    </div>
  );
}
