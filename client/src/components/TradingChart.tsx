import { useEffect, useRef, useCallback, useMemo } from "react";
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

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

function shiftToEastern(utcTimestamp: number): number {
  const d = new Date(utcTimestamp * 1000);
  const parts = etFormatter.formatToParts(d);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || "0", 10);
  const etYear = get("year");
  const etMonth = get("month") - 1;
  const etDay = get("day");
  const etHour = get("hour") === 24 ? 0 : get("hour");
  const etMin = get("minute");
  const etSec = get("second");
  const fakeUtc = Date.UTC(etYear, etMonth, etDay, etHour, etMin, etSec);
  return Math.floor(fakeUtc / 1000);
}

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

export interface ChartIndicators {
  ema5: (number | null)[];
  ema10: (number | null)[];
  sma21: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  avwapHigh?: (number | null)[];
  avwapLow?: (number | null)[];
}

export interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "circle" | "arrowDown" | "arrowUp";
  text: string;
}

export interface PriceLevelLine {
  price: number;
  color: string;
  label: string;
  lineStyle?: "solid" | "dotted" | "dashed";
  lineWidth?: number;
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
  };
  onCandleClick?: (candle: ChartCandle, clickedPrice: number) => void;
  markers?: ChartMarker[];
  priceLines?: PriceLevelLine[];
  showLegend?: boolean;
  height?: number;
  timeframe?: string;
  snapToPrice?: number | null;
  showDayDividers?: boolean;
  maSettings?: MaSettingForChart[];
}

const SYSTEM_ROW_TO_FIELD: Record<string, keyof ChartIndicators> = {
  sys_sma5: "ema5",
  sys_sma10: "ema10",
  sys_sma20: "sma21",
  sys_sma50: "sma50",
  sys_sma200: "sma200",
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

    const avwapConfigs = [
      { key: "avwapHigh" as const, label: "VWAP", color: "#f97316", style: LineStyle.Dotted },
      { key: "avwapLow" as const, label: "Daily VWAP", color: "#38bdf8", style: LineStyle.Dotted },
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

export function TradingChart({
  data,
  onCandleClick,
  markers,
  priceLines,
  showLegend = true,
  height,
  timeframe = "daily",
  snapToPrice,
  showDayDividers = false,
  maSettings,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const onCandleClickRef = useRef(onCandleClick);
  const candlesRef = useRef(data.candles);
  const markersHandleRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  const maLineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  useEffect(() => {
    onCandleClickRef.current = onCandleClick;
  }, [onCandleClick]);

  useEffect(() => {
    candlesRef.current = data.candles;
  }, [data.candles]);

  const isIntraday = timeframe !== "daily";

  const displayData = useMemo(() => {
    if (!isIntraday) return data;
    const shiftedCandles = data.candles.map(c => ({
      ...c,
      timestamp: shiftToEastern(c.timestamp),
    }));
    return { ...data, candles: shiftedCandles };
  }, [data, isIntraday]);

  const shiftedToOriginal = useMemo(() => {
    if (!isIntraday) return null;
    const map = new Map<number, ChartCandle>();
    for (let i = 0; i < data.candles.length; i++) {
      map.set(displayData.candles[i].timestamp, data.candles[i]);
    }
    return map;
  }, [data.candles, displayData.candles, isIntraday]);

  const handleChartClick = useCallback(
    (param: any) => {
      if (!onCandleClickRef.current || !param.time || !candleSeriesRef.current) return;

      let timestamp: number;
      if (typeof param.time === "object") {
        timestamp = Math.floor(
          new Date(
            `${param.time.year}-${String(param.time.month).padStart(2, "0")}-${String(param.time.day).padStart(2, "0")}`
          ).getTime() / 1000
        );
      } else {
        timestamp = param.time as number;
      }

      let candle: ChartCandle | undefined;
      if (shiftedToOriginal) {
        candle = shiftedToOriginal.get(timestamp);
        if (!candle) {
          let closestKey = 0;
          let minDiff = Infinity;
          shiftedToOriginal.forEach((_val, key) => {
            const diff = Math.abs(key - timestamp);
            if (diff < minDiff) { minDiff = diff; closestKey = key; }
          });
          if (minDiff < 3600) candle = shiftedToOriginal.get(closestKey);
        }
      } else {
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
      }
      if (candle) {
        let clickedPrice = candle.close;
        if (param.point && typeof param.point.y === "number") {
          const priceFromY = candleSeriesRef.current.coordinateToPrice(param.point.y);
          if (priceFromY !== null && isFinite(priceFromY)) {
            clickedPrice = Math.round(priceFromY * 100) / 100;
          }
        }
        onCandleClickRef.current(candle, clickedPrice);
      }
    },
    []
  );

  useEffect(() => {
    if (!containerRef.current || displayData.candles.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersHandleRef.current = null;
      priceLinesRef.current = [];
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
        mode: 1,
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
            let h = d.getUTCHours();
            const m = d.getUTCMinutes();
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${h}:${m.toString().padStart(2, "0")} ${ampm}`;
          }
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
        },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
        timeVisible: isIntraday,
        secondsVisible: false,
        rightOffset: 5,
        tickMarkFormatter: (time: any) => {
          const d = new Date(time * 1000);
          if (isIntraday) {
            let h = d.getUTCHours();
            const m = d.getUTCMinutes();
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            return m === 0 ? `${h} ${ampm}` : `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
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
        const dateStr = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
        if (dateStr !== prevDateStr && prevDateStr !== "") {
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

    chart.subscribeCrosshairMove(() => {});
    chart.subscribeClick(handleChartClick);

    chart.timeScale().fitContent();

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
      if (chartRef.current) {
        chartRef.current.unsubscribeClick(handleChartClick);
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        markersHandleRef.current = null;
        priceLinesRef.current = [];
        maLineSeriesRef.current = [];
      }
    };
  }, [displayData, height, isIntraday, showDayDividers, timeframe]);

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
      const displayMarkers = isIntraday
        ? markers.map(m => ({ ...m, time: shiftToEastern(m.time) }))
        : markers;
      const sorted = [...displayMarkers].sort((a, b) => a.time - b.time);
      markersHandleRef.current = createSeriesMarkers(
        candleSeriesRef.current,
        sorted.map((m) => ({
          time: m.time as any,
          position: m.position,
          shape: m.shape,
          color: m.color,
          text: m.text,
        }))
      );
    }
  }, [markers, isIntraday]);


  useEffect(() => {
    if (!candleSeriesRef.current) return;

    for (const pl of priceLinesRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(pl);
      } catch {}
    }
    priceLinesRef.current = [];

    if (priceLines && priceLines.length > 0) {
      for (const pl of priceLines) {
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
      }
    }
  }, [priceLines]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    const resetCrosshair = () => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        crosshair: {
          mode: 1,
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
          mode: 0,
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
    if (data.indicators.avwapHigh?.some(v => v !== null)) {
      items.push({ key: "avwapHigh", label: "VWAP", color: "#f97316", isDotted: true, isDashed: false });
    }
    if (data.indicators.avwapLow?.some(v => v !== null)) {
      items.push({ key: "avwapLow", label: "Daily VWAP", color: "#38bdf8", isDotted: true, isDashed: false });
    }
    return items;
  }, [maSettings, timeframe, data.indicators]);

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
      <div ref={containerRef} className="w-full flex-1 min-h-[400px]" />
    </div>
  );
}
