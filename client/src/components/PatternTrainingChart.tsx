import { useEffect, useRef, useCallback } from "react";
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

export interface ChartCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartIndicators {
  ema5: (number | null)[];
  ema10: (number | null)[];
  sma21: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  avwapHigh?: (number | null)[];
  avwapLow?: (number | null)[];
}

interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "circle" | "arrowDown" | "arrowUp";
  text: string;
}

interface ResistanceLine {
  price1: number;
  price2: number;
}

interface PriceLevelLine {
  price: number;
  color: string;
  label: string;
}

interface PatternTrainingChartProps {
  data: {
    candles: ChartCandle[];
    indicators: ChartIndicators;
  };
  onCandleClick?: (candle: ChartCandle, clickedPrice: number) => void;
  markers?: ChartMarker[];
  resistanceLine?: ResistanceLine | null;
  priceLines?: PriceLevelLine[];
  height?: number;
}

const MA_CONFIG = [
  { key: "ema5" as const, label: "5 EMA", color: "#66bb6a" },
  { key: "ema10" as const, label: "10 EMA", color: "#42a5f5" },
  { key: "sma21" as const, label: "21 SMA", color: "#ec4899" },
  { key: "sma50" as const, label: "50 SMA", color: "#ef5350" },
  { key: "sma200" as const, label: "200 SMA", color: "#ffffff" },
];

export function PatternTrainingChart({
  data,
  onCandleClick,
  markers,
  resistanceLine,
  priceLines,
  height,
}: PatternTrainingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const onCandleClickRef = useRef(onCandleClick);
  const candlesRef = useRef(data.candles);
  const markersHandleRef = useRef<any>(null);
  const resistSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<any[]>([]);
  const chartHeightRef = useRef(height || 500);

  useEffect(() => {
    onCandleClickRef.current = onCandleClick;
  }, [onCandleClick]);

  useEffect(() => {
    candlesRef.current = data.candles;
  }, [data.candles]);

  const handleChartClick = useCallback(
    (param: any) => {
      if (!onCandleClickRef.current || !param.time || !candleSeriesRef.current) return;

      const timestamp =
        typeof param.time === "object"
          ? Math.floor(
              new Date(
                `${param.time.year}-${String(param.time.month).padStart(2, "0")}-${String(param.time.day).padStart(2, "0")}`
              ).getTime() / 1000
            )
          : (param.time as number);

      const candle = candlesRef.current.find((c) => c.timestamp === timestamp);
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

  const chartHeight = height || 500;
  chartHeightRef.current = chartHeight;

  useEffect(() => {
    if (!containerRef.current || data.candles.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersHandleRef.current = null;
      resistSeriesRef.current = [];
      priceLinesRef.current = [];
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: chartHeightRef.current,
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
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
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

    const candleData: CandlestickData[] = data.candles.map((c) => ({
      time: c.timestamp as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(candleData);

    for (const ma of MA_CONFIG) {
      const indicatorValues = data.indicators[ma.key];
      if (!indicatorValues || indicatorValues.length === 0) continue;

      const lineData: LineData[] = [];
      for (let i = 0; i < indicatorValues.length; i++) {
        const val = indicatorValues[i];
        if (val !== null && i < data.candles.length) {
          lineData.push({
            time: data.candles[i].timestamp as any,
            value: val,
          });
        }
      }

      if (lineData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: ma.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(lineData);
      }
    }

    const avwapConfigs = [
      { key: "avwapHigh" as const, label: "VWAP", color: "#f97316", style: LineStyle.Dotted },
      { key: "avwapLow" as const, label: "Daily VWAP", color: "#38bdf8", style: LineStyle.Dotted },
    ];

    for (const avwap of avwapConfigs) {
      const vals = data.indicators[avwap.key];
      if (!vals || vals.length === 0) continue;

      const lineData: LineData[] = [];
      for (let i = 0; i < vals.length; i++) {
        const val = vals[i];
        if (val !== null && i < data.candles.length) {
          lineData.push({ time: data.candles[i].timestamp as any, value: val });
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
      }
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const volumeData: HistogramData[] = data.candles.map((c) => ({
      time: c.timestamp as any,
      value: c.volume,
      color:
        c.close >= c.open
          ? "rgba(34, 197, 94, 0.3)"
          : "rgba(239, 68, 68, 0.3)",
    }));

    volumeSeries.setData(volumeData);

    chart.subscribeCrosshairMove(() => {});
    chart.subscribeClick(handleChartClick);

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (chartRef.current) {
          chartRef.current.applyOptions({
            width: entry.contentRect.width,
          });
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
        resistSeriesRef.current = [];
        priceLinesRef.current = [];
      }
    };
  }, [data]);

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
        }))
      );
    }
  }, [markers]);

  useEffect(() => {
    if (!chartRef.current || data.candles.length === 0) return;

    for (const s of resistSeriesRef.current) {
      try {
        chartRef.current.removeSeries(s);
      } catch {}
    }
    resistSeriesRef.current = [];

    if (!resistanceLine) return;

    const firstTime = data.candles[0].timestamp;
    const lastTime = data.candles[data.candles.length - 1].timestamp;

    const resistSeries1 = chartRef.current.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    resistSeries1.setData([
      { time: firstTime as any, value: resistanceLine.price1 },
      { time: lastTime as any, value: resistanceLine.price1 },
    ]);
    resistSeriesRef.current.push(resistSeries1);

    if (resistanceLine.price2 !== resistanceLine.price1) {
      const resistSeries2 = chartRef.current.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      resistSeries2.setData([
        { time: firstTime as any, value: resistanceLine.price2 },
        { time: lastTime as any, value: resistanceLine.price2 },
      ]);
      resistSeriesRef.current.push(resistSeries2);
    }
  }, [resistanceLine, data.candles]);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height: chartHeight });
    }
    if (containerRef.current) {
      containerRef.current.style.height = `${chartHeight}px`;
    }
  }, [chartHeight]);

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
        const line = candleSeriesRef.current.createPriceLine({
          price: pl.price,
          color: pl.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: pl.label,
        });
        priceLinesRef.current.push(line);
      }
    }
  }, [priceLines]);

  return (
    <div data-testid="chart-pattern-training" className="relative w-full">
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 rounded bg-slate-900/80 px-2 py-1.5">
        {MA_CONFIG.map((ma) => (
          <div key={ma.key} className="flex items-center gap-1.5 text-xs">
            <div
              className="h-0.5 w-3 rounded"
              style={{ backgroundColor: ma.color }}
            />
            <span className="text-slate-400">{ma.label}</span>
          </div>
        ))}
        {data.indicators.avwapHigh && data.indicators.avwapHigh.some(v => v !== null) && (
          <div className="flex items-center gap-1.5 text-xs">
            <div className="h-0.5 w-3 rounded border-b border-dotted" style={{ borderColor: "#f97316" }} />
            <span className="text-slate-400">VWAP</span>
          </div>
        )}
        {data.indicators.avwapLow && data.indicators.avwapLow.some(v => v !== null) && (
          <div className="flex items-center gap-1.5 text-xs">
            <div className="h-0.5 w-3 rounded border-b border-dotted" style={{ borderColor: "#38bdf8" }} />
            <span className="text-slate-400">Daily VWAP</span>
          </div>
        )}
      </div>
      <div ref={containerRef} className="w-full" style={{ height: chartHeight }} />
    </div>
  );
}
