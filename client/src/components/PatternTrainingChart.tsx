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
  sma10: (number | null)[];
  ema21: (number | null)[];
  sma50: (number | null)[];
  sma150: (number | null)[];
  sma200: (number | null)[];
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

interface PatternTrainingChartProps {
  data: {
    candles: ChartCandle[];
    indicators: ChartIndicators;
  };
  onCandleClick?: (candle: ChartCandle) => void;
  markers?: ChartMarker[];
  resistanceLine?: ResistanceLine | null;
}

const MA_CONFIG = [
  { key: "sma10" as const, label: "10 SMA", color: "#42a5f5" },
  { key: "ema21" as const, label: "21 EMA", color: "#66bb6a" },
  { key: "sma50" as const, label: "50 SMA", color: "#ef5350" },
  { key: "sma150" as const, label: "150 SMA", color: "#9e9e9e" },
  { key: "sma200" as const, label: "200 SMA", color: "#cccccc" },
];

export function PatternTrainingChart({
  data,
  onCandleClick,
  markers,
  resistanceLine,
}: PatternTrainingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const handleChartClick = useCallback(
    (param: any) => {
      if (!onCandleClick || !param.time || !candleSeriesRef.current) return;

      const timestamp =
        typeof param.time === "object"
          ? Math.floor(
              new Date(
                `${param.time.year}-${String(param.time.month).padStart(2, "0")}-${String(param.time.day).padStart(2, "0")}`
              ).getTime() / 1000
            )
          : (param.time as number);

      const candle = data.candles.find((c) => c.timestamp === timestamp);
      if (candle) {
        onCandleClick(candle);
      }
    },
    [onCandleClick, data.candles]
  );

  useEffect(() => {
    if (!containerRef.current || data.candles.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 500,
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

    if (markers && markers.length > 0) {
      const sorted = [...markers].sort((a, b) => a.time - b.time);
      const seriesMarkers = createSeriesMarkers(
        candleSeries,
        sorted.map((m) => ({
          time: m.time as any,
          position: m.position,
          shape: m.shape,
          color: m.color,
          text: m.text,
        }))
      );
    }

    if (resistanceLine) {
      const resistSeries1 = chart.addSeries(LineSeries, {
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      const firstTime = data.candles[0].timestamp;
      const lastTime = data.candles[data.candles.length - 1].timestamp;

      resistSeries1.setData([
        { time: firstTime as any, value: resistanceLine.price1 },
        { time: lastTime as any, value: resistanceLine.price1 },
      ]);

      if (resistanceLine.price2 !== resistanceLine.price1) {
        const resistSeries2 = chart.addSeries(LineSeries, {
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
      }
    }

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
      }
    };
  }, [data, markers, resistanceLine, handleChartClick]);

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
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 500 }} />
    </div>
  );
}
