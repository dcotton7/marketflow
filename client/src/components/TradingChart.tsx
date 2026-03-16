import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  createChart,
  IChartApi,
  CandlestickData,
  HistogramData,
  LineData,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  ISeriesApi,
} from "lightweight-charts";
import { DEFAULT_MA_TEMPLATE, BARS_PER_DAY } from "@shared/indicatorTemplates";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaSettingsDialog } from "@/components/MaSettingsDialog";

function computeSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

function computeEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (ema === null) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      ema = sum / period;
    } else {
      ema = closes[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

function getEffectivePeriod(setting: MaSettingForChart, timeframe: string): number | null {
  if (setting.period == null) return null;
  if (setting.calcOn === "intraday") return setting.period;
  const bpd = BARS_PER_DAY[timeframe];
  if (bpd == null || bpd <= 0) return setting.period;
  return Math.max(1, Math.round(setting.period * bpd));
}

export interface ChartCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Gap {
  index: number;
  isUp: boolean;
  originalTop: number;
  originalBottom: number;
  currentTop: number;
  currentBottom: number;
  isTouched: boolean;
  isFilled: boolean;
  filledBarIndex: number | null;
  createdAt: number;
  expiresAt: number;
}

export interface ChartIndicators {
  ema5: (number | null)[];
  ema10: (number | null)[];
  sma21: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  vwap?: (number | null)[];
  avwapHigh?: (number | null)[];
  avwapLow?: (number | null)[];
}

export interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "circle" | "square" | "arrowDown" | "arrowUp";
  text: string;
  size?: number;
  textColor?: string;
}

export interface DiamondMarker {
  time: number;
  price: number;
  color: string;
  size: number;
  text?: string;
  textColor?: string;
}

export interface PriceLevelLine {
  price: number;
  color: string;
  label: string;
  lineStyle?: "solid" | "dotted" | "dashed";
  lineWidth?: number;
}

export interface BaseZone {
  startTime: number;
  endTime: number;
  topPrice: number;
  lowPrice: number;
  color: string;
  label?: string;
}

export interface MaSettingForChart {
  rowId: string;
  title: string;
  maType: string;
  period: number | null;
  color: string;
  lineType: number;
  isVisible: boolean;
  dailyOn: boolean;
  fiveMinOn: boolean;
  fifteenMinOn: boolean;
  thirtyMinOn: boolean;
  calcOn?: "daily" | "intraday";
}

export interface TradingChartProps {
  data: {
    candles: ChartCandle[];
    indicators: ChartIndicators;
    gaps?: Gap[];
  };
  onCandleClick?: (candle: ChartCandle, clickedPrice: number) => void;
  markers?: ChartMarker[];
  diamondMarkers?: DiamondMarker[];
  priceLines?: PriceLevelLine[];
  showLegend?: boolean;
  height?: number;
  timeframe?: string;
  snapToPrice?: number | null;
  showDayDividers?: boolean;
  maSettings?: MaSettingForChart[];
  maxBars?: number;
  measureMode?: boolean;
  trendLineMode?: boolean;
  showGaps?: boolean;
  resistanceLines?: { startTime: number; startPrice: number; endTime: number; endPrice: number }[];
  baseZones?: BaseZone[];
  drawingToolActive?: string | null;
  onChartReady?: (chartApi: IChartApi, seriesApi: ISeriesApi<"Candlestick">) => void;
  onChartClick?: (param: any) => void;
  onChartMouseDown?: (param: any) => void;
  onChartCrosshairMove?: (param: any) => void;
  onChartMouseUp?: () => void;
}

const SYSTEM_ROW_TO_FIELD: Record<string, keyof ChartIndicators> = {
  sys_sma5: "ema5",
  sys_sma10: "ema10",
  sys_sma20: "sma21",
  sys_sma50: "sma50",
  sys_sma200: "sma200",
  sys_vwap: "vwap",
  sys_vwap_hi: "avwapHigh",
  sys_vwap_lo: "avwapLow",
};

const LINE_TYPE_TO_STYLE: Record<number, number> = {
  0: LineStyle.Solid,
  1: LineStyle.Dashed,
  2: LineStyle.Dotted,
  3: LineStyle.LargeDashed,
  4: LineStyle.SparseDotted,
};

function getTimeframeToggle(setting: MaSettingForChart, timeframe: string): boolean {
  if (timeframe === "daily" || timeframe === "1d") return setting.dailyOn;
  if (timeframe === "5min" || timeframe === "5m") return setting.fiveMinOn;
  if (timeframe === "15min" || timeframe === "15m") return setting.fifteenMinOn;
  if (timeframe === "30min" || timeframe === "30m") return setting.thirtyMinOn;
  return setting.dailyOn;
}

const INDICATOR_FIELD_MAP: { field: keyof ChartIndicators; templateId: string }[] = [
  { field: "ema5",   templateId: "ma5" },
  { field: "ema10",  templateId: "ma10" },
  { field: "sma21",  templateId: "ma20" },
  { field: "sma50",  templateId: "ma50" },
  { field: "sma200", templateId: "ma200" },
];

const MA_CONFIG = INDICATOR_FIELD_MAP.map(({ field, templateId }) => {
  const def = DEFAULT_MA_TEMPLATE.find(d => d.id === templateId);
  return {
    key: field,
    label: def ? `${def.label} ${def.type.toUpperCase()}` : field,
    color: def?.color ?? "#94a3b8",
    lineWidth: def?.lineWidth ?? 1,
  };
});

function renderMaLinesToChart(
  chart: IChartApi,
  settings: MaSettingForChart[] | undefined,
  chartData: { candles: ChartCandle[]; indicators: ChartIndicators },
  tf: string
): ISeriesApi<"Line">[] {
  const addedSeries: ISeriesApi<"Line">[] = [];

  if (settings && settings.length > 0) {
    const closes = chartData.candles.map(c => c.close);
    for (const setting of settings) {
      if (!getTimeframeToggle(setting, tf)) continue;

      let indicatorValues: (number | null)[] | undefined;

      const field = SYSTEM_ROW_TO_FIELD[setting.rowId];
      if (field) {
        indicatorValues = chartData.indicators[field];
      } else if (setting.maType === "sma" || setting.maType === "ema") {
        const effectivePeriod = getEffectivePeriod(setting, tf);
        if (effectivePeriod != null && effectivePeriod > 0 && closes.length > 0) {
          indicatorValues = setting.maType === "ema"
            ? computeEMA(closes, effectivePeriod)
            : computeSMA(closes, effectivePeriod);
        }
      }

      if (!indicatorValues || indicatorValues.length === 0) continue;

      const lineData: LineData[] = [];
      for (let i = 0; i < indicatorValues.length; i++) {
        const val = indicatorValues[i];
        if (val !== null && i < chartData.candles.length) {
          lineData.push({ time: chartData.candles[i].timestamp as any, value: val });
        }
      }

      if (lineData.length > 0) {
        const lwStyle = LINE_TYPE_TO_STYLE[setting.lineType] ?? LineStyle.Solid;
        const series = chart.addSeries(LineSeries, {
          color: setting.color,
          lineWidth: (setting.maType === "vwap" || setting.maType === "vwap_hi" || setting.maType === "vwap_lo" ? 2 : (setting.period && setting.period >= 20 ? 2 : 1)) as 1 | 2 | 3 | 4,
          lineStyle: lwStyle,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(lineData);
        addedSeries.push(series);
      }
    }
  } else {
    for (const ma of MA_CONFIG) {
      const indicatorValues = chartData.indicators[ma.key];
      if (!indicatorValues || indicatorValues.length === 0) continue;

      const lineData: LineData[] = [];
      for (let i = 0; i < indicatorValues.length; i++) {
        const val = indicatorValues[i];
        if (val !== null && i < chartData.candles.length) {
          lineData.push({ time: chartData.candles[i].timestamp as any, value: val });
        }
      }

      if (lineData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: ma.color,
          lineWidth: (ma.lineWidth || 1) as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(lineData);
        addedSeries.push(series);
      }
    }

    const vwapVals = chartData.indicators.vwap;
    if (vwapVals && vwapVals.length > 0) {
      const lineData: LineData[] = [];
      for (let i = 0; i < vwapVals.length; i++) {
        const val = vwapVals[i];
        if (val !== null && i < chartData.candles.length) {
          lineData.push({ time: chartData.candles[i].timestamp as any, value: val });
        }
      }
      if (lineData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: "#fbbf24",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(lineData);
        addedSeries.push(series);
      }
    }

    const avwapConfigs = [
      { key: "avwapHigh" as const, label: "VWAP Hi", color: "#f97316", style: LineStyle.Dotted },
      { key: "avwapLow" as const, label: "VWAP Lo", color: "#38bdf8", style: LineStyle.Dotted },
    ];

    for (const avwap of avwapConfigs) {
      const vals = chartData.indicators[avwap.key];
      if (!vals || vals.length === 0) continue;

      const lineData: LineData[] = [];
      for (let i = 0; i < vals.length; i++) {
        const val = vals[i];
        if (val !== null && i < chartData.candles.length) {
          lineData.push({ time: chartData.candles[i].timestamp as any, value: val });
        }
      }

      if (lineData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: avwap.color,
          lineWidth: 2,
          lineStyle: avwap.style,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(lineData);
        addedSeries.push(series);
      }
    }
  }

  return addedSeries;
}

interface MeasurePoint {
  time: number;
  price: number;
}

class MeasurePrimitive {
  _series: any = null;
  _startPoint: MeasurePoint | null = null;
  _endPoint: MeasurePoint | null = null;
  _requestUpdate: (() => void) | null = null;

  setPoints(start: MeasurePoint | null, end: MeasurePoint | null) {
    this._startPoint = start;
    this._endPoint = end;
    if (this._requestUpdate) this._requestUpdate();
  }

  attached({ series, requestUpdate }: any) {
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews() {
    return this;
  }

  paneViews() {
    return [this];
  }

  zOrder(): "top" {
    return "top";
  }

  renderer() {
    return this;
  }

  draw(target: any) {
    if (!this._startPoint || !this._endPoint || !this._series) return;

    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const ts = this._series.chart().timeScale();

      const x1Raw = ts.timeToCoordinate(this._startPoint!.time as any);
      const x2Raw = ts.timeToCoordinate(this._endPoint!.time as any);
      const y1Raw = this._series.priceToCoordinate(this._startPoint!.price);
      const y2Raw = this._series.priceToCoordinate(this._endPoint!.price);

      if (x1Raw == null || x2Raw == null || y1Raw == null || y2Raw == null) return;

      const x1 = Math.round(x1Raw * ratio);
      const x2 = Math.round(x2Raw * ratio);
      const y1 = Math.round(y1Raw * vRatio);
      const y2 = Math.round(y2Raw * vRatio);

      ctx.save();

      ctx.setLineDash([6 * ratio, 4 * ratio]);
      ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
      ctx.lineWidth = 1.5 * ratio;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const circleR = 4 * ratio;
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(250, 204, 21, 0.9)";
      ctx.beginPath();
      ctx.arc(x1, y1, circleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x2, y2, circleR, 0, Math.PI * 2);
      ctx.fill();

      const priceDiff = this._endPoint!.price - this._startPoint!.price;
      const pctChange = ((priceDiff / this._startPoint!.price) * 100);
      const sign = priceDiff >= 0 ? "+" : "";
      const label = `${sign}${priceDiff.toFixed(2)}  (${sign}${pctChange.toFixed(2)}%)`;

      const fontSize = Math.round(22 * ratio);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;

      const textMetrics = ctx.measureText(label);
      const textWidth = textMetrics.width;
      const textHeight = fontSize;
      const padX = 6 * ratio;
      const padY = 4 * ratio;

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const boxX = midX - textWidth / 2 - padX;
      const boxY = midY - textHeight / 2 - padY - 10 * vRatio;

      const bgColor = priceDiff >= 0 ? "rgba(34, 197, 94, 0.85)" : "rgba(239, 68, 68, 0.85)";
      ctx.fillStyle = bgColor;
      const boxW = textWidth + padX * 2;
      const boxH = textHeight + padY * 2;
      const cornerR = 4 * ratio;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, cornerR);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(label, midX, boxY + boxH / 2);

      ctx.restore();
    });
  }
}

export function TradingChart({
  data: rawData,
  onCandleClick,
  markers,
  diamondMarkers,
  priceLines,
  showLegend = true,
  height,
  timeframe = "daily",
  snapToPrice,
  showDayDividers = false,
  maSettings,
  maxBars,
  measureMode = false,
  trendLineMode = false,
  showGaps = false,
  resistanceLines,
  baseZones,
  drawingToolActive,
  onChartReady,
  onChartClick,
  onChartMouseDown,
  onChartCrosshairMove,
  onChartMouseUp,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const onCandleClickRef = useRef(onCandleClick);
  const candlesRef = useRef(rawData.candles);
  const markersHandleRef = useRef<any>(null);
  const diamondPrimitiveRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  const latestPriceLinesRef = useRef(priceLines); // Store latest priceLines for re-application after chart recreation
  const maLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const measurePrimitiveRef = useRef<MeasurePrimitive | null>(null);
  const measureStartRef = useRef<MeasurePoint | null>(null);
  const shiftKeyRef = useRef(false);
  const measureModeRef = useRef(measureMode);
  const resistanceLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const baseZoneSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const gapSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const [measureStartPrice, setMeasureStartPrice] = useState<number | null>(null);
  const [measureEndPrice, setMeasureEndPrice] = useState<number | null>(null);
  const [chartReady, setChartReady] = useState(false);
  
  // Debug log to see what priceLines are received
  useEffect(() => {
    console.log(`[TradingChart] Component rendered - timeframe: ${timeframe}, priceLines received:`, priceLines?.length ?? 0, priceLines);
  }, [timeframe, priceLines]);
  
  useEffect(() => {
    measureModeRef.current = measureMode;
    if (!measureMode) {
      setMeasureStartPrice(null);
      setMeasureEndPrice(null);
      measureStartRef.current = null;
      if (measurePrimitiveRef.current) {
        measurePrimitiveRef.current.setPoints(null, null);
      }
    }
  }, [measureMode]);
  useEffect(() => {
    onCandleClickRef.current = onCandleClick;
  }, [onCandleClick]);

  const data = rawData;

  useEffect(() => {
    candlesRef.current = data.candles;
  }, [data.candles]);

  const isIntraday = timeframe !== "daily";
  // IMPORTANT: candle timestamps are UTC epoch seconds from the server.
  // We do NOT shift timestamps to ET; we only format display labels in ET.
  const displayData = data;

  const clearMeasure = useCallback(() => {
    measureStartRef.current = null;
    if (measurePrimitiveRef.current) {
      measurePrimitiveRef.current.setPoints(null, null);
    }
    setMeasureStartPrice(null);
    setMeasureEndPrice(null);
  }, []);

  const onChartClickRef = useRef(onChartClick);
  const onChartMouseDownRef = useRef(onChartMouseDown);
  const onChartCrosshairMoveRef = useRef(onChartCrosshairMove);
  const onChartMouseUpRef = useRef(onChartMouseUp);
  const drawingToolActiveRef = useRef(drawingToolActive);
  useEffect(() => { onChartClickRef.current = onChartClick; }, [onChartClick]);
  useEffect(() => { onChartMouseDownRef.current = onChartMouseDown; }, [onChartMouseDown]);
  useEffect(() => { onChartCrosshairMoveRef.current = onChartCrosshairMove; }, [onChartCrosshairMove]);
  useEffect(() => { onChartMouseUpRef.current = onChartMouseUp; }, [onChartMouseUp]);
  useEffect(() => { drawingToolActiveRef.current = drawingToolActive; }, [drawingToolActive]);

  const matchBusinessDayToCandle = useCallback((t: { year: number; month: number; day: number }): number => {
    const candles = candlesRef.current;
    const matchCandle = candles.find(c => {
      const d = new Date(c.timestamp * 1000);
      return d.getUTCFullYear() === t.year && (d.getUTCMonth() + 1) === t.month && d.getUTCDate() === t.day;
    });
    return matchCandle ? matchCandle.timestamp : Math.floor(
      Date.UTC(t.year, t.month - 1, t.day) / 1000
    );
  }, []);

  const findNearestCandleTime = useCallback((xCoord: number): number | null => {
    const candles = candlesRef.current;
    const chart = chartRef.current;
    if (!candles.length || !chart) return null;
    const ts = chart.timeScale();
    let bestDist = Infinity;
    let bestTs: number | null = null;
    for (const c of candles) {
      const cx = ts.timeToCoordinate(c.timestamp as any);
      if (cx == null) continue;
      const dist = Math.abs(cx - xCoord);
      if (dist < bestDist) {
        bestDist = dist;
        bestTs = c.timestamp;
      }
    }
    return bestTs;
  }, []);

  const resolveClickTime = useCallback((param: any): number | null => {
    if (param.time) {
      if (typeof param.time === "object") {
        return matchBusinessDayToCandle(param.time as { year: number; month: number; day: number });
      }
      return param.time as number;
    }
    if (chartRef.current && param.point && typeof param.point.x === "number") {
      try {
        const timeVal = chartRef.current.timeScale().coordinateToTime(param.point.x);
        if (timeVal != null) {
          if (typeof timeVal === "object") {
            return matchBusinessDayToCandle(timeVal as { year: number; month: number; day: number });
          }
          return timeVal as number;
        }
      } catch {}
      return findNearestCandleTime(param.point.x);
    }
    return null;
  }, [matchBusinessDayToCandle, findNearestCandleTime]);

  const handleChartClick = useCallback(
    (param: any) => {
      const resolvedTime = resolveClickTime(param);

      if (onChartClickRef.current) {
        const enrichedParam = { ...param, _resolvedTime: resolvedTime };
        onChartClickRef.current(enrichedParam);
      }

      if (drawingToolActiveRef.current) return;

      if (!resolvedTime || !candleSeriesRef.current) return;

      const timestamp = resolvedTime;

      let clickedPrice: number | null = null;
      if (param.point && typeof param.point.y === "number") {
        const priceFromY = candleSeriesRef.current.coordinateToPrice(param.point.y);
        if (priceFromY !== null && isFinite(priceFromY)) {
          clickedPrice = priceFromY;
        }
      }

      if ((shiftKeyRef.current || measureModeRef.current) && clickedPrice !== null) {
        if (!measureStartRef.current) {
          measureStartRef.current = { time: timestamp, price: clickedPrice };
          setMeasureStartPrice(clickedPrice);
          setMeasureEndPrice(null);
          if (measurePrimitiveRef.current) {
            measurePrimitiveRef.current.setPoints(null, null);
          }
        } else {
          const endPoint: MeasurePoint = { time: timestamp, price: clickedPrice };
          if (measurePrimitiveRef.current) {
            measurePrimitiveRef.current.setPoints(measureStartRef.current, endPoint);
          }
          setMeasureEndPrice(clickedPrice);
          measureStartRef.current = null;
        }
        return;
      }

      if (!onCandleClickRef.current) return;
      let candle: ChartCandle | undefined;
      candle = candlesRef.current.find((c) => c.timestamp === timestamp);
      if (!candle && candlesRef.current.length > 0) {
        let closest = candlesRef.current[0];
        let minDiff = Math.abs(closest.timestamp - timestamp);
        for (const c of candlesRef.current) {
          const diff = Math.abs(c.timestamp - timestamp);
          if (diff < minDiff) { minDiff = diff; closest = c; }
        }
        if (minDiff < 3600) candle = closest;
      }
      if (candle) {
        let resolvedPrice = candle.close;
        if (clickedPrice !== null) {
          resolvedPrice = clickedPrice;
        }
        onCandleClickRef.current(candle, resolvedPrice);
      }
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current || displayData.candles.length === 0) return;

    if (chartRef.current) {
      console.log(`[TradingChart] Cleaning up chart - setting chartReady=false, timeframe: ${timeframe}`);
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersHandleRef.current = null;
      priceLinesRef.current = [];
      setChartReady(false);
    }

    const containerHeight = height || containerRef.current.clientHeight || 500;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.06)" },
        horzLines: { color: "rgba(148, 163, 184, 0.06)" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
      },
      localization: {
        timeFormatter: (time: any) => {
          const ts = typeof time === "object" && time !== null ? (time as any).timestamp ?? time : time;
          const d = new Date(ts * 1000);
          if (isIntraday) {
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            // Alpaca data is already in UTC, need to display in ET
            // Get locale time components in ET timezone
            const etHour = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
            const etMin = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
            const etMonth = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric" })) - 1;
            const etDay = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", day: "numeric" }));
            const ampm = etHour >= 12 ? "PM" : "AM";
            const displayHour = etHour % 12 || 12;
            return `${months[etMonth]} ${etDay}, ${displayHour}:${etMin.toString().padStart(2, "0")} ${ampm}`;
          }
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
        },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 7,
        tickMarkFormatter: (time: any) => {
          const d = new Date(time * 1000);
          if (isIntraday) {
            // Convert UTC to ET by parsing individual components
            const etHour = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
            const etMin = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
            const ampm = etHour >= 12 ? "PM" : "AM";
            const displayHour = etHour % 12 || 12;
            return etMin === 0 ? `${displayHour} ${ampm}` : `${displayHour}:${etMin.toString().padStart(2, "0")} ${ampm}`;
          }
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    candleSeriesRef.current = candleSeries;

    const candleData: CandlestickData[] = displayData.candles.map((c) => ({
      time: c.timestamp as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(candleData);

    maLineSeriesRef.current = renderMaLinesToChart(chart, maSettings, displayData, timeframe);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const volumeData: HistogramData[] = displayData.candles.map((c) => ({
      time: c.timestamp as any,
      value: c.volume,
      color:
        c.close >= c.open
          ? "rgba(34, 197, 94, 0.3)"
          : "rgba(239, 68, 68, 0.3)",
    }));

    volumeSeries.setData(volumeData);

    if (showDayDividers && isIntraday && displayData.candles.length > 0) {
      const dayBoundaryTimestamps: number[] = [];
      let prevDateStr = "";
      for (const c of displayData.candles) {
        const d = new Date(c.timestamp * 1000);
        // Get ET date components for proper day boundary detection
        const etYear = d.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric" });
        const etMonth = d.toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric" });
        const etDay = d.toLocaleString("en-US", { timeZone: "America/New_York", day: "numeric" });
        const etHour = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
        const etMin = parseInt(d.toLocaleString("en-US", { timeZone: "America/New_York", minute: "2-digit" }));
        
        const dateStr = `${etYear}-${etMonth}-${etDay}`;
        const etTotalMin = etHour * 60 + etMin;
        
        // Mark boundary at first bar of each new trading day (at or after 9:30 AM ET = 570 min)
        if (dateStr !== prevDateStr && prevDateStr !== "" && etTotalMin >= 570) {
          dayBoundaryTimestamps.push(c.timestamp);
        }
        prevDateStr = dateStr;
      }

      if (dayBoundaryTimestamps.length > 0) {
        const dividerSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "dayDividers",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        chart.priceScale("dayDividers").applyOptions({
          scaleMargins: { top: 0, bottom: 0 },
          visible: false,
        });
        const maxPrice = Math.max(...displayData.candles.map(c => c.high));
        const dividerData: HistogramData[] = dayBoundaryTimestamps.map(ts => ({
          time: ts as any,
          value: maxPrice * 10,
          color: "rgba(148, 163, 184, 0.15)",
        }));
        dividerSeries.setData(dividerData);
      }
    }

    const measurePrimitive = new MeasurePrimitive();
    candleSeries.attachPrimitive(measurePrimitive);
    measurePrimitiveRef.current = measurePrimitive;

    const crosshairHandler = (param: any) => {
      if (onChartCrosshairMoveRef.current) {
        const resolvedTime = resolveClickTime(param);
        const enrichedParam = { ...param, _resolvedTime: resolvedTime };
        onChartCrosshairMoveRef.current(enrichedParam);
      }
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    chart.subscribeClick(handleChartClick);

    console.log(`[TradingChart] Chart initialized - setting chartReady=true, timeframe: ${timeframe}, priceLines count: ${priceLines?.length ?? 0}`);
    setChartReady(true);
    
    if (onChartReady) {
      onChartReady(chart, candleSeries);
    }

    const chartContainer = containerRef.current;
    const mouseDownHandler = (e: MouseEvent) => {
      if (onChartMouseDownRef.current) {
        const rect = chartContainer!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        onChartMouseDownRef.current({ point: { x, y } });
      }
    };
    const mouseUpHandler = () => {
      if (onChartMouseUpRef.current) {
        onChartMouseUpRef.current();
      }
    };
    chartContainer!.addEventListener("mousedown", mouseDownHandler);
    document.addEventListener("mouseup", mouseUpHandler);

    if (maxBars && displayData.candles.length > maxBars) {
      const from = displayData.candles.length - maxBars;
      const to = displayData.candles.length - 1;
      chart.timeScale().setVisibleLogicalRange({ from, to });
    } else {
      chart.timeScale().fitContent();
    }
    chart.timeScale().scrollToPosition(7, false);
    requestAnimationFrame(() => {
      if (chartRef.current) {
        chartRef.current.timeScale().scrollToPosition(7, false);
      }
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (chartRef.current) {
          const w = entry.contentRect.width;
          const h = entry.contentRect.height;
          if (w > 0 && h > 0) {
            chartRef.current.applyOptions({ width: w, height: h });
          }
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      measurePrimitiveRef.current = null;
      measureStartRef.current = null;
      if (chartContainer) {
        chartContainer.removeEventListener("mousedown", mouseDownHandler);
      }
      document.removeEventListener("mouseup", mouseUpHandler);
      if (chartRef.current) {
        chartRef.current.unsubscribeCrosshairMove(crosshairHandler);
        chartRef.current.unsubscribeClick(handleChartClick);
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        markersHandleRef.current = null;
        priceLinesRef.current = [];
        setChartReady(false);
        maLineSeriesRef.current = [];
        for (const s of resistanceLineSeriesRef.current) {
          try { chart.removeSeries(s); } catch {}
        }
        resistanceLineSeriesRef.current = [];
        for (const s of baseZoneSeriesRef.current) {
          try { chart.removeSeries(s); } catch {}
        }
        baseZoneSeriesRef.current = [];
      }
    };
  }, [displayData, isIntraday, showDayDividers, timeframe]);

  useEffect(() => {
    if (!chartRef.current || !height) return;
    chartRef.current.applyOptions({ height });
  }, [height]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    if (maxBars && displayData.candles.length > maxBars) {
      const from = displayData.candles.length - maxBars;
      const to = displayData.candles.length - 1;
      chart.timeScale().setVisibleLogicalRange({ from, to });
    }
  }, [maxBars]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    for (const s of maLineSeriesRef.current) {
      try { chart.removeSeries(s); } catch {}
    }
    maLineSeriesRef.current = renderMaLinesToChart(chart, maSettings, displayData, timeframe);
  }, [maSettings]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;

    if (markersHandleRef.current) {
      try {
        markersHandleRef.current.detach();
      } catch {}
      markersHandleRef.current = null;
    }

    if (markers && markers.length > 0) {
      const sorted = [...markers].sort((a, b) => a.time - b.time);
      markersHandleRef.current = createSeriesMarkers(
        candleSeriesRef.current,
        sorted.map((m) => ({
          time: m.time as any,
          position: m.position,
          shape: m.shape,
          color: m.color,
          text: m.text,
          ...(m.size ? { size: m.size } : {}),
          ...(m.textColor ? { textColor: m.textColor } : {}),
        }))
      );
    }
  }, [markers, isIntraday]);

  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current) return;

    if (diamondPrimitiveRef.current) {
      try {
        candleSeriesRef.current.detachPrimitive(diamondPrimitiveRef.current);
      } catch {}
      diamondPrimitiveRef.current = null;
    }

    if (diamondMarkers && diamondMarkers.length > 0) {
      const series = candleSeriesRef.current;
      const chart = chartRef.current;
      const displayDiamonds = diamondMarkers;

      const primitive = {
        _markers: displayDiamonds,
        updateAllViews() {},
        paneViews() {
          return [{
            renderer() {
              return {
                draw(target: any) {
                  target.useBitmapCoordinateSpace((scope: any) => {
                    const ctx = scope.context;
                    const ratio = scope.horizontalPixelRatio;
                    const vRatio = scope.verticalPixelRatio;
                    const ts = chart.timeScale();

                    for (const dm of displayDiamonds) {
                      const x = ts.timeToCoordinate(dm.time as any);
                      if (x === null) continue;
                      const y = series.priceToCoordinate(dm.price);
                      if (y === null) continue;

                      const px = Math.round(x * ratio);
                      const py = Math.round(y * vRatio);
                      const half = Math.round((dm.size / 2) * ratio);

                      ctx.save();
                      ctx.beginPath();
                      ctx.moveTo(px, py - half);
                      ctx.lineTo(px + half, py);
                      ctx.lineTo(px, py + half);
                      ctx.lineTo(px - half, py);
                      ctx.closePath();
                      ctx.fillStyle = dm.color;
                      ctx.fill();

                      if (dm.text) {
                        const fontSize = Math.max(10, Math.round(11 * ratio));
                        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
                        ctx.fillStyle = dm.textColor || "#ffffff";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "top";
                        ctx.fillText(dm.text, px, py + half + Math.round(4 * vRatio));
                      }
                      ctx.restore();
                    }
                  });
                },
              };
            },
          }];
        },
      };

      series.attachPrimitive(primitive as any);
      diamondPrimitiveRef.current = primitive;
    }
  }, [diamondMarkers, isIntraday]);

  // Keep latestPriceLinesRef in sync with priceLines prop
  useEffect(() => {
    console.log(`[TradingChart] Updating latestPriceLinesRef - timeframe: ${timeframe}, count: ${priceLines?.length ?? 0}`);
    latestPriceLinesRef.current = priceLines;
  }, [priceLines, timeframe]);

  // Apply price lines when chart is ready or priceLines change
  useEffect(() => {
    console.log(`[PriceLines] Effect triggered - chartReady: ${chartReady}, candleSeries: ${!!candleSeriesRef.current}, priceLines prop: ${priceLines?.length ?? 0}, latestPriceLinesRef: ${latestPriceLinesRef.current?.length ?? 0}, timeframe: ${timeframe}`);
    
    if (!candleSeriesRef.current || !chartReady) {
      console.log(`[PriceLines] Skipping - chart not ready (chartReady=${chartReady}, candleSeries=${!!candleSeriesRef.current})`);
      return;
    }

    // Clear existing price lines
    for (const pl of priceLinesRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(pl);
      } catch {}
    }
    priceLinesRef.current = [];

    // Use latestPriceLinesRef to ensure we get the most recent values
    const linesToDraw = latestPriceLinesRef.current;
    console.log(`[PriceLines] Drawing ${linesToDraw?.length ?? 0} lines from latestPriceLinesRef:`, linesToDraw);
    
    if (linesToDraw && linesToDraw.length > 0) {
      for (const pl of linesToDraw) {
        const lwStyle = pl.lineStyle === "solid" ? LineStyle.Solid
          : pl.lineStyle === "dashed" ? LineStyle.Dashed
          : LineStyle.Dotted;
        const line = candleSeriesRef.current.createPriceLine({
          price: pl.price,
          color: pl.color,
          lineWidth: (pl.lineWidth || 1) as any,
          lineStyle: lwStyle,
          axisLabelVisible: true,
          title: pl.label,
        });
        priceLinesRef.current.push(line);
        console.log(`[PriceLines] Created line: ${pl.label} @ $${pl.price}`);
      }
    }
  }, [priceLines, chartReady, timeframe]);

  useEffect(() => {
    if (!chartRef.current) return;
    for (const s of resistanceLineSeriesRef.current) {
      try { chartRef.current.removeSeries(s); } catch {}
    }
    resistanceLineSeriesRef.current = [];

    try {
      if (resistanceLines && resistanceLines.length > 0) {
        for (const rl of resistanceLines) {
          const series = chartRef.current!.addSeries(LineSeries, {
            color: "#ef4444",
            lineWidth: 2 as 2,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
            autoscaleInfoProvider: () => null,
          });
          const points = [
            { time: rl.startTime as any, value: rl.startPrice },
            { time: rl.endTime as any, value: rl.endPrice },
          ];
          series.setData(points);
          resistanceLineSeriesRef.current.push(series);
        }
      }
    } catch (e) {
      console.warn("[TradingChart] resistanceLines render error:", e);
    }
  }, [resistanceLines, displayData]);

  useEffect(() => {
    if (!chartRef.current) return;
    for (const s of baseZoneSeriesRef.current) {
      try { chartRef.current.removeSeries(s); } catch {}
    }
    baseZoneSeriesRef.current = [];

    try {
      if (baseZones && baseZones.length > 0) {
        for (const zone of baseZones) {
          const topSeries = chartRef.current!.addSeries(LineSeries, {
            color: zone.color,
            lineWidth: 2 as 2,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
            autoscaleInfoProvider: () => null,
          });
          topSeries.setData([
            { time: zone.startTime as any, value: zone.topPrice },
            { time: zone.endTime as any, value: zone.topPrice },
          ]);
          baseZoneSeriesRef.current.push(topSeries);

          const bottomSeries = chartRef.current!.addSeries(LineSeries, {
            color: zone.color,
            lineWidth: 2 as 2,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
            autoscaleInfoProvider: () => null,
          });
          bottomSeries.setData([
            { time: zone.startTime as any, value: zone.lowPrice },
            { time: zone.endTime as any, value: zone.lowPrice },
          ]);
          baseZoneSeriesRef.current.push(bottomSeries);
        }
      }
    } catch (e) {
      console.warn("[TradingChart] baseZones render error:", e);
    }
  }, [baseZones, displayData]);

  // Render Support/Resistance Gaps
  useEffect(() => {
    // Always clear previous gap series when deps change
    if (chartRef.current && gapSeriesRef.current.length > 0) {
      for (const s of gapSeriesRef.current) {
        if (s == null) continue;
        try { chartRef.current.removeSeries(s); } catch (e) {
          console.warn('[TradingChart] Error removing gap series:', e);
        }
      }
      gapSeriesRef.current = [];
    }

    // Early return if conditions not met
    if (!chartRef.current || !showGaps || !data.gaps || data.gaps.length === 0) {
      return;
    }

    console.log(`[TradingChart] Rendering ${data.gaps.length} gaps`);

    try {
      const candles = data.candles;
      if (!candles || candles.length === 0) {
        console.warn('[TradingChart] No candles available for gap rendering');
        return;
      }
      
      let renderedCount = 0;
      
      for (const gap of data.gaps) {
        // Skip filled gaps
        if (gap.isFilled) continue;
        
        // Validate gap index
        if (typeof gap.index !== 'number' || gap.index < 0 || gap.index >= candles.length) {
          console.warn(`[TradingChart] Invalid gap index: ${gap.index} (candles length: ${candles.length})`);
          continue;
        }
        
        const startCandle = candles[gap.index];
        const endCandle = candles[candles.length - 1];
        
        if (!startCandle || !endCandle) {
          console.warn(`[TradingChart] Missing candle data for gap at index ${gap.index}`);
          continue;
        }
        
        let startTime = startCandle.timestamp;
        let endTime = endCandle.timestamp;
        
        if (!startTime || !endTime) {
          console.warn(`[TradingChart] Missing timestamp for gap at index ${gap.index}`);
          continue;
        }
        // lightweight-charts requires strictly ascending time; avoid duplicate timestamps
        if (endTime <= startTime) endTime = startTime + 1;
        
        // CORRECT Drendel Gap Logic: GRAY until touched, then GREEN/RED
        const isGapUp = gap.isUp;
        
        // Color based on touched status (matching TradingView)
        let lineColor: string;
        if (!gap.isTouched) {
          lineColor = "rgb(128, 128, 128)"; // GRAY for untouched
        } else if (isGapUp) {
          lineColor = "rgb(0, 255, 0)"; // GREEN when touched (support confirmed)
        } else {
          lineColor = "rgb(255, 0, 0)"; // RED when touched (resistance confirmed)
        }
        
        try {
          console.log(`[Gap ${renderedCount}] ${isGapUp ? 'UP' : 'DOWN'} | ${gap.isTouched ? 'TOUCHED' : 'UNTOUCHED'} | Top: ${gap.currentTop.toFixed(2)}, Bottom: ${gap.currentBottom.toFixed(2)}`);
          
          // Create semi-transparent fill color (20% opacity)
          const fillColor = !gap.isTouched 
            ? "rgba(128, 128, 128, 0.2)" 
            : isGapUp 
              ? "rgba(0, 255, 0, 0.2)" 
              : "rgba(255, 0, 0, 0.2)";
          
          // Calculate number of filler lines based on gap height
          const gapHeight = gap.currentTop - gap.currentBottom;
          const avgPrice = (gap.currentTop + gap.currentBottom) / 2;
          const gapPercentage = (gapHeight / avgPrice) * 100; // Gap as % of price
          
          // More lines for larger gaps: 1% = 5 lines, 2% = 10 lines, etc (min 3, max 15)
          const numFillerLines = Math.min(15, Math.max(3, Math.round(gapPercentage * 5)));
          
          // Draw filler lines between top and bottom to create filled effect
          for (let i = 0; i < numFillerLines; i++) {
            const fillLevel = gap.currentBottom + (gapHeight * (i + 1) / (numFillerLines + 1)); // Evenly spaced
            const fillSeries = chartRef.current.addSeries(LineSeries, {
              color: fillColor,
              lineWidth: 3,
              lineStyle: LineStyle.Solid,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              priceScaleId: 'right',
              autoscaleInfoProvider: () => null,
            });
            
            fillSeries.setData([
              { time: startTime as any, value: fillLevel },
              { time: endTime as any, value: fillLevel },
            ]);
            
            gapSeriesRef.current.push(fillSeries);
          }
          
          // Create semi-transparent border color (60% opacity)
          const borderColor = !gap.isTouched 
            ? "rgba(128, 128, 128, 0.6)" 
            : isGapUp 
              ? "rgba(0, 255, 0, 0.6)" 
              : "rgba(255, 0, 0, 0.6)";
          
          // Draw TOP border line (semi-transparent)
          const topSeries = chartRef.current.addSeries(LineSeries, {
            color: borderColor,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
            autoscaleInfoProvider: () => null,
          });
          
          topSeries.setData([
            { time: startTime as any, value: gap.currentTop },
            { time: endTime as any, value: gap.currentTop },
          ]);
          
          gapSeriesRef.current.push(topSeries);
          
          // Draw BOTTOM border line (semi-transparent)
          const bottomSeries = chartRef.current.addSeries(LineSeries, {
            color: borderColor,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
            autoscaleInfoProvider: () => null,
          });
          
          bottomSeries.setData([
            { time: startTime as any, value: gap.currentBottom },
            { time: endTime as any, value: gap.currentBottom },
          ]);
          
          gapSeriesRef.current.push(bottomSeries);
          
          renderedCount++;
        } catch (e) {
          console.error(`[TradingChart] Error rendering gap:`, e);
        }
      }
      
      console.log(`[TradingChart] Successfully rendered ${renderedCount} gaps`);
    } catch (e) {
      console.error("[TradingChart] Critical error in gaps rendering:", e);
      // Clear any partially rendered gaps
      for (const s of gapSeriesRef.current) {
        if (s == null) continue;
        try { chartRef.current?.removeSeries(s); } catch {}
      }
      gapSeriesRef.current = [];
    }
  }, [showGaps, data.gaps, data.candles]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    const resetCrosshair = () => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        crosshair: {
          mode: 0,
          horzLine: {
            visible: true,
            labelVisible: true,
            color: "rgba(148, 163, 184, 0.3)" as any,
            width: 1 as any,
            style: LineStyle.Dashed,
          },
        },
      });
    };
    if (snapToPrice != null) {
      chartRef.current.applyOptions({
        crosshair: {
          mode: 1,
          horzLine: {
            visible: true,
            labelVisible: true,
            color: "rgba(250, 204, 21, 0.5)",
            width: 2 as any,
            style: LineStyle.Solid,
          },
        },
      });
      let isSnapping = false;
      const handler = (param: any) => {
        if (isSnapping) return;
        if (!param.time || !candleSeriesRef.current || !chartRef.current) return;
        isSnapping = true;
        chartRef.current.setCrosshairPosition(snapToPrice, param.time, candleSeriesRef.current);
        isSnapping = false;
      };
      chartRef.current.subscribeCrosshairMove(handler);
      return () => {
        if (chartRef.current) {
          chartRef.current.unsubscribeCrosshairMove(handler);
        }
        resetCrosshair();
      };
    } else {
      resetCrosshair();
    }
  }, [snapToPrice]);

  const legendItems = useMemo(() => {
    if (maSettings && maSettings.length > 0) {
      return maSettings
        .filter(s => getTimeframeToggle(s, timeframe) && (SYSTEM_ROW_TO_FIELD[s.rowId] || s.maType === "sma" || s.maType === "ema"))
        .map(s => ({
          key: s.rowId,
          label: s.title,
          color: s.color,
          isDotted: s.lineType === 2 || s.lineType === 4,
          isDashed: s.lineType === 1 || s.lineType === 3,
        }));
    }
    const items: { key: string; label: string; color: string; isDotted: boolean; isDashed: boolean }[] = MA_CONFIG.map(ma => ({
      key: ma.key,
      label: ma.label,
      color: ma.color,
      isDotted: false,
      isDashed: false,
    }));
    if (data.indicators.vwap?.some(v => v !== null)) {
      items.push({ key: "vwap", label: "VWAP", color: "#fbbf24", isDotted: false, isDashed: true });
    }
    if (data.indicators.avwapHigh?.some(v => v !== null)) {
      items.push({ key: "avwapHigh", label: "VWAP Hi", color: "#f97316", isDotted: true, isDashed: false });
    }
    if (data.indicators.avwapLow?.some(v => v !== null)) {
      items.push({ key: "avwapLow", label: "VWAP Lo", color: "#38bdf8", isDotted: true, isDashed: false });
    }
    return items;
  }, [maSettings, timeframe, data.indicators]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftKeyRef.current = true;
      if (e.key === "Escape") clearMeasure();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftKeyRef.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [clearMeasure]);

  const [showMaSettings, setShowMaSettings] = useState(false);

  return (
    <div data-testid="chart-trading" className="relative w-full h-full flex flex-col">
      {showLegend && legendItems.length > 0 && (
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 rounded bg-slate-900/80 px-2 py-1.5">
          {legendItems.map((item: { key: string; label: string; color: string; isDotted: boolean; isDashed: boolean }) => (
            <div key={item.key} className="flex items-center gap-1.5 text-xs">
              <div
                className="h-0.5 w-3 rounded"
                style={item.isDotted || item.isDashed
                  ? { borderBottomWidth: "1px", borderBottomStyle: item.isDotted ? "dotted" : "dashed", borderColor: item.color }
                  : { backgroundColor: item.color }
                }
              />
              <span className="text-slate-400">{item.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {measureMode && (
          <div className="flex items-center gap-1.5 mr-1 pointer-events-none">
            <div className="flex items-center gap-1 bg-slate-900/80 rounded px-2 py-1">
              <span className="text-[10px] text-slate-400 whitespace-nowrap">Start Price (click):</span>
              <span className={`text-[11px] font-mono ${measureStartPrice !== null ? "text-rs-yellow" : "text-slate-500"}`} data-testid="text-measure-start-price">
                {measureStartPrice !== null ? `$${measureStartPrice.toFixed(2)}` : "$\u2014"}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-slate-900/80 rounded px-2 py-1">
              <span className="text-[10px] text-slate-400 whitespace-nowrap">End Price (click):</span>
              <span className={`text-[11px] font-mono ${measureEndPrice !== null ? "text-rs-yellow" : "text-slate-500"}`} data-testid="text-measure-end-price">
                {measureEndPrice !== null ? `$${measureEndPrice.toFixed(2)}` : "$\u2014"}
              </span>
            </div>
            {measureStartPrice !== null && measureEndPrice !== null && (
              <div className="flex items-center gap-1 bg-slate-900/80 rounded px-2 py-1">
                <span className={`text-[11px] font-mono font-semibold ${measureEndPrice >= measureStartPrice ? "text-rs-green" : "text-rs-red"}`} data-testid="text-measure-delta">
                  {measureEndPrice >= measureStartPrice ? "+" : ""}{(measureEndPrice - measureStartPrice).toFixed(2)} ({measureEndPrice >= measureStartPrice ? "+" : ""}{(((measureEndPrice - measureStartPrice) / measureStartPrice) * 100).toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 bg-slate-900/60 hover-elevate"
          onClick={(e) => { e.stopPropagation(); setShowMaSettings(true); }}
          data-testid="button-chart-indicator-settings"
        >
          <Settings2 className="h-3.5 w-3.5 text-slate-400" />
        </Button>
      </div>
      <div ref={containerRef} className="w-full flex-1 min-h-[400px]" style={drawingToolActive ? { cursor: 'crosshair' } : undefined} />
      <MaSettingsDialog open={showMaSettings} onOpenChange={setShowMaSettings} />
    </div>
  );
}
