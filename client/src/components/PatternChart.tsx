import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, CandlestickData, LineData, ColorType, CandlestickSeries, LineSeries } from "lightweight-charts";

interface PatternChartProps {
  symbol: string;
  indicators: string[];
  height?: number;
  timeframe?: string;
}

interface StockBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function dateToTimestamp(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function calculateSMA(data: StockBar[], period: number): LineData[] {
  const result: LineData[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0);
    result.push({
      time: dateToTimestamp(data[i].date) as any,
      value: sum / period
    });
  }
  return result;
}

function calculateEMA(data: StockBar[], period: number): LineData[] {
  const result: LineData[] = [];
  const multiplier = 2 / (period + 1);
  let ema = 0;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      continue;
    } else if (i === period - 1) {
      const sum = data.slice(0, period).reduce((acc, d) => acc + d.close, 0);
      ema = sum / period;
      result.push({ time: dateToTimestamp(data[i].date) as any, value: ema });
    } else {
      ema = (data[i].close - ema) * multiplier + ema;
      result.push({ time: dateToTimestamp(data[i].date) as any, value: ema });
    }
  }
  return result;
}

function calculateVWAP(data: StockBar[]): LineData[] {
  const result: LineData[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
    
    if (cumulativeVolume > 0) {
      result.push({
        time: dateToTimestamp(data[i].date) as any,
        value: cumulativeTPV / cumulativeVolume
      });
    }
  }
  return result;
}

const INDICATOR_COLORS: Record<string, string> = {
  'VWAP': '#f59e0b',
  '9 EMA': '#22c55e',
  '9 SMA': '#22c55e',
  '20 EMA': '#3b82f6',
  '20 SMA': '#3b82f6',
  '21 EMA': '#3b82f6',
  '21 SMA': '#3b82f6',
  '50 EMA': '#a855f7',
  '50 SMA': '#a855f7',
  '200 EMA': '#ef4444',
  '200 SMA': '#ef4444',
  'default': '#6b7280'
};

function getIndicatorColor(indicator: string): string {
  const normalized = indicator.toUpperCase().trim();
  for (const [key, color] of Object.entries(INDICATOR_COLORS)) {
    if (normalized.includes(key.toUpperCase())) {
      return color;
    }
  }
  return INDICATOR_COLORS.default;
}

function parseIndicator(indicator: string): { type: 'sma' | 'ema' | 'vwap' | 'unknown', period: number } {
  const normalized = indicator.toLowerCase().trim().replace(/[()]/g, '');
  
  if (normalized.includes('vwap')) {
    return { type: 'vwap', period: 0 };
  }
  
  const emaMatch = normalized.match(/(\d+)\s*ema/) || normalized.match(/ema\s*(\d+)/);
  if (emaMatch) {
    return { type: 'ema', period: parseInt(emaMatch[1]) };
  }
  
  const smaMatch = normalized.match(/(\d+)\s*sma/) || normalized.match(/sma\s*(\d+)/);
  if (smaMatch) {
    return { type: 'sma', period: parseInt(smaMatch[1]) };
  }
  
  const maMatch = normalized.match(/(\d+)\s*ma\b/) || normalized.match(/ma\s*(\d+)/);
  if (maMatch) {
    return { type: 'sma', period: parseInt(maMatch[1]) };
  }
  
  return { type: 'unknown', period: 0 };
}

export function PatternChart({ symbol, indicators, height = 300, timeframe = 'D' }: PatternChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stockData, setStockData] = useState<StockBar[]>([]);

  useEffect(() => {
    if (!symbol) return;
    
    setLoading(true);
    setError(null);
    
    const period = timeframe === 'D' || timeframe === 'W' ? '1y' : '5d';
    const interval = timeframe === 'W' ? '1wk' : timeframe === 'D' ? '1d' : '1h';
    
    let cancelled = false;
    
    const fetchWithRetry = async (retries = 3, delay = 1000) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        if (cancelled) return;
        
        try {
          const res = await fetch(`/api/stocks/${symbol}/history?period=${period}&interval=${interval}`);
          
          // Parse JSON even on error responses to get better messages
          const data = await res.json().catch(() => ({}));
          
          if (!res.ok) {
            const errorMsg = data.message || data.error || `HTTP ${res.status}`;
            throw new Error(res.status === 429 ? 'Rate limited - try again' : errorMsg);
          }
          
          if (cancelled) return;
          
          if (data.error || data.message) {
            throw new Error(data.error || data.message);
          } else if (Array.isArray(data) && data.length > 0) {
            setStockData(data);
            setLoading(false);
            return;
          } else if (data.data && Array.isArray(data.data)) {
            setStockData(data.data);
            setLoading(false);
            return;
          } else {
            throw new Error('No chart data available');
          }
        } catch (err: any) {
          const isLastAttempt = attempt >= retries - 1;
          if (!isLastAttempt) {
            await new Promise(r => setTimeout(r, delay * (attempt + 1)));
          } else {
            if (!cancelled) {
              const message = err?.message || 'Failed to fetch data';
              setError(message.includes('Rate limit') ? 'Rate limited - try again' : message);
              setLoading(false);
            }
          }
        }
      }
    };
    
    fetchWithRetry();
    
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!containerRef.current || stockData.length === 0) return;

    // Wait for container to have dimensions
    const containerWidth = containerRef.current.clientWidth;
    if (containerWidth <= 0) {
      // Retry after a small delay
      const timer = setTimeout(() => {
        if (containerRef.current) {
          const newWidth = containerRef.current.clientWidth;
          if (newWidth > 0 && chartRef.current === null) {
            // Trigger re-render
            setStockData([...stockData]);
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }

    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(containerRef.current, {
      width: containerWidth || 400,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
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
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const candleData: CandlestickData[] = stockData.map(bar => ({
      time: dateToTimestamp(bar.date) as any,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    candleSeries.setData(candleData);

    for (const indicator of indicators) {
      const parsed = parseIndicator(indicator);
      let lineData: LineData[] = [];
      
      if (parsed.type === 'vwap') {
        lineData = calculateVWAP(stockData);
      } else if (parsed.type === 'sma' && parsed.period > 0) {
        lineData = calculateSMA(stockData, parsed.period);
      } else if (parsed.type === 'ema' && parsed.period > 0) {
        lineData = calculateEMA(stockData, parsed.period);
      }
      
      if (lineData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: getIndicatorColor(indicator),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(lineData);
      }
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [stockData, indicators, height]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        {error}
      </div>
    );
  }

  if (stockData.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        No chart data available for {symbol}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div ref={containerRef} className="w-full" style={{ height, minWidth: '100%' }} />
      {indicators.length > 0 && (
        <div className="flex gap-3 mt-2 flex-wrap">
          {indicators.map((ind, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-xs">
              <div 
                className="w-3 h-0.5 rounded"
                style={{ backgroundColor: getIndicatorColor(ind) }}
              />
              <span className="text-muted-foreground">{ind}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
