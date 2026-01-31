import { useEffect, useRef, useState } from "react";
import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2 } from "lucide-react";
import { 
  createChart, 
  IChartApi, 
  CandlestickSeries, 
  HistogramSeries, 
  LineSeries,
  CandlestickData, 
  HistogramData, 
  Time, 
  LineStyle 
} from "lightweight-charts";

interface StockChartProps {
  symbol: string;
}

interface ConsolidationChannel {
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  type: 'VCP' | 'Weekly Tight' | 'Monthly Tight';
}

function calculateSMA(data: { close: number }[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, item) => acc + item.close, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

function detectConsolidationChannels(
  data: { date: string; high: number; low: number; close: number; volume: number }[]
): ConsolidationChannel[] {
  const channels: ConsolidationChannel[] = [];
  
  if (data.length < 5) return channels;
  
  const weeklyData = data.slice(-20);
  if (weeklyData.length >= 5) {
    const weeklyHigh = Math.max(...weeklyData.map(c => c.high));
    const weeklyLow = Math.min(...weeklyData.map(c => c.low));
    const avgPrice = weeklyData.reduce((sum, c) => sum + c.close, 0) / weeklyData.length;
    const rangePercent = ((weeklyHigh - weeklyLow) / avgPrice) * 100;
    
    if (rangePercent <= 12) {
      channels.push({
        startTime: new Date(weeklyData[0].date).getTime() / 1000,
        endTime: new Date(weeklyData[weeklyData.length - 1].date).getTime() / 1000,
        high: weeklyHigh,
        low: weeklyLow,
        type: 'Weekly Tight'
      });
    }
  }
  
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
          startTime: new Date(monthlyData[0].date).getTime() / 1000,
          endTime: new Date(monthlyData[monthlyData.length - 1].date).getTime() / 1000,
          high: monthlyHigh,
          low: monthlyLow,
          type: 'Monthly Tight'
        });
      }
    }
  }
  
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
        startTime: new Date(period3[0].date).getTime() / 1000,
        endTime: new Date(period3[period3.length - 1].date).getTime() / 1000,
        high: vcpHigh,
        low: vcpLow,
        type: 'VCP'
      });
    }
  }
  
  return channels;
}

export function StockChart({ symbol }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [channels, setChannels] = useState<ConsolidationChannel[]>([]);
  
  const { data: history, isLoading, error } = useStockHistory(symbol);

  useEffect(() => {
    if (!chartContainerRef.current || !history || history.length === 0) return;

    const isDark = document.documentElement.classList.contains('dark');
    
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 450,
      layout: {
        background: { color: isDark ? '#1a1a2e' : '#ffffff' },
        textColor: isDark ? '#a0a0a0' : '#333333',
      },
      grid: {
        vertLines: { color: isDark ? '#2a2a3e' : '#f0f0f0' },
        horzLines: { color: isDark ? '#2a2a3e' : '#f0f0f0' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: isDark ? '#3a3a4e' : '#e0e0e0',
      },
      timeScale: {
        borderColor: isDark ? '#3a3a4e' : '#e0e0e0',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const candleData: CandlestickData[] = history.map(item => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }));
    candlestickSeries.setData(candleData);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

    const volumeData: HistogramData[] = history.map(item => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      value: item.volume,
      color: item.close >= item.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
    }));
    volumeSeries.setData(volumeData);

    const sma5 = calculateSMA(history, 5);
    const sma20 = calculateSMA(history, 20);
    const sma50 = calculateSMA(history, 50);
    const sma200 = calculateSMA(history, 200);

    const sma5Series = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma5Data = history.map((item, i) => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      value: sma5[i] ?? undefined,
    })).filter(d => d.value !== undefined) as { time: Time; value: number }[];
    sma5Series.setData(sma5Data);

    const sma20Series = chart.addSeries(LineSeries, {
      color: '#ec4899',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma20Data = history.map((item, i) => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      value: sma20[i] ?? undefined,
    })).filter(d => d.value !== undefined) as { time: Time; value: number }[];
    sma20Series.setData(sma20Data);

    const sma50Series = chart.addSeries(LineSeries, {
      color: '#dc2626',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma50Data = history.map((item, i) => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      value: sma50[i] ?? undefined,
    })).filter(d => d.value !== undefined) as { time: Time; value: number }[];
    sma50Series.setData(sma50Data);

    const sma200Series = chart.addSeries(LineSeries, {
      color: isDark ? '#ffffff' : '#000000',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const sma200Data = history.map((item, i) => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      value: sma200[i] ?? undefined,
    })).filter(d => d.value !== undefined) as { time: Time; value: number }[];
    sma200Series.setData(sma200Data);

    const detectedChannels = detectConsolidationChannels(history);
    setChannels(detectedChannels);

    detectedChannels.forEach(channel => {
      const topLine = chart.addSeries(LineSeries, {
        color: '#000000',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      topLine.setData([
        { time: channel.startTime as Time, value: channel.high },
        { time: channel.endTime as Time, value: channel.high },
      ]);

      const bottomLine = chart.addSeries(LineSeries, {
        color: '#000000',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bottomLine.setData([
        { time: channel.startTime as Time, value: channel.low },
        { time: channel.endTime as Time, value: channel.low },
      ]);
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [history]);

  if (isLoading) {
    return (
      <div 
        className="h-[500px] w-full flex items-center justify-center bg-card rounded-xl border border-border"
        data-testid="chart-loading"
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !history) {
    return (
      <div 
        className="h-[500px] w-full flex items-center justify-center bg-card rounded-xl border border-border text-muted-foreground"
        data-testid="chart-error"
      >
        Failed to load chart data
      </div>
    );
  }

  return (
    <div className="w-full bg-card p-4 rounded-xl border border-border shadow-sm" data-testid="stock-chart">
      <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
        <h3 className="font-semibold text-foreground">Price History</h3>
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-blue-500 inline-block"></span>
              <span className="text-muted-foreground">SMA 5</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-pink-500 inline-block"></span>
              <span className="text-muted-foreground">SMA 20</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-red-600 inline-block"></span>
              <span className="text-muted-foreground">SMA 50</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-black dark:bg-white inline-block"></span>
              <span className="text-muted-foreground">SMA 200</span>
            </span>
          </div>
          {channels.length > 0 && (
            <div className="flex gap-2 text-xs">
              {channels.map((ch, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded border border-black dark:border-white bg-green-100 dark:bg-green-900/30">
                  <span className="text-foreground font-medium">{ch.type}</span>
                </span>
              ))}
            </div>
          )}
          <span className="text-xs text-muted-foreground font-mono">Daily</span>
        </div>
      </div>
      
      <div ref={chartContainerRef} className="w-full" data-testid="chart-container" />
    </div>
  );
}
