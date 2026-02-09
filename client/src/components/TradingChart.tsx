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
}

const MA_CONFIG = [
  { key: "ema5" as const, label: "5 EMA", color: "#66bb6a" },
  { key: "ema10" as const, label: "10 EMA", color: "#42a5f5" },
  { key: "sma21" as const, label: "21 SMA", color: "#ec4899" },
  { key: "sma50" as const, label: "50 SMA", color: "#ef5350" },
  { key: "sma200" as const, label: "200 SMA", color: "#ffffff" },
];

export function TradingChart({
  data,
  onCandleClick,
  markers,
  priceLines,
  showLegend = true,
  height,
  timeframe = "daily",
  snapToPrice,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const onCandleClickRef = useRef(onCandleClick);
  const candlesRef = useRef(data.candles);
  const markersHandleRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  useEffect(() => {
    onCandleClickRef.current = onCandleClick;
  }, [onCandleClick]);

  useEffect(() => {
    candlesRef.current = data.candles;
  }, [data.candles]);

  const isIntraday = timeframe !== "daily";

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

      let candle = candlesRef.current.find((c) => c.timestamp === timestamp);
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
    if (!containerRef.current || data.candles.length === 0) return;

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
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
        timeVisible: isIntraday,
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
      }
    };
  }, [data, height, isIntraday]);

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

  return (
    <div data-testid="chart-trading" className="relative w-full h-full flex flex-col">
      {showLegend && (
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
      )}
      <div ref={containerRef} className="w-full flex-1 min-h-[400px]" />
    </div>
  );
}
