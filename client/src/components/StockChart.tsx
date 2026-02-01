import { useEffect, useRef, useState, useCallback } from "react";
import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2, Layers, Ruler, Minus, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  createChart, 
  IChartApi, 
  CandlestickSeries, 
  HistogramSeries, 
  LineSeries,
  CandlestickData, 
  HistogramData, 
  Time, 
  LineStyle,
  ISeriesApi,
  SeriesType
} from "lightweight-charts";

interface StockChartProps {
  symbol: string;
  showChannels?: boolean;
  selectedPattern?: string;
}

interface HorizontalLineDefinition {
  id: string;
  price: number;
}

interface MeasurePoint {
  price: number;
}

const TIMEFRAMES = [
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '60m', value: '60m' },
  { label: 'Daily', value: '1d' },
  { label: 'Weekly', value: '1wk' },
  { label: 'Monthly', value: '1mo' },
];

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

// Calculate Daily VWAP (resets each day for intraday, cumulative for daily+)
function calculateVWAP(data: { date: string; high: number; low: number; close: number; volume: number }[], isIntraday: boolean): (number | null)[] {
  const vwap: (number | null)[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = '';
  
  for (let i = 0; i < data.length; i++) {
    const itemDate = new Date(data[i].date);
    const dayKey = isIntraday ? itemDate.toDateString() : '';
    
    // Reset cumulative values at start of new day for intraday data
    if (isIntraday && dayKey !== currentDay) {
      cumulativeTPV = 0;
      cumulativeVolume = 0;
      currentDay = dayKey;
    }
    
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
    
    if (cumulativeVolume > 0) {
      vwap.push(cumulativeTPV / cumulativeVolume);
    } else {
      vwap.push(null);
    }
  }
  return vwap;
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

interface HighTightFlagData {
  poleStart: number;
  poleLow: number;
  poleEnd: number;
  poleHigh: number;
  flagStart: number;
  flagEnd: number;
  flagHigh: number;
  flagLow: number;
}

function detectHighTightFlag(
  data: { date: string; high: number; low: number; close: number; volume: number }[]
): HighTightFlagData | null {
  if (data.length < 20) return null;
  
  // For visualization purposes, show the consolidation in last 10-15 bars
  // with relaxed thresholds to show something useful on the chart
  const flagBars = data.slice(-15);
  const preFlagBars = data.slice(-45, -15);
  
  if (preFlagBars.length < 10) return null;
  
  // Find the pole: look for the strong upward move before the flag
  // Find lowest point in first half of pre-flag and highest in second half
  const firstHalf = preFlagBars.slice(0, Math.floor(preFlagBars.length / 2));
  const secondHalf = preFlagBars.slice(Math.floor(preFlagBars.length / 2));
  
  const poleLowIdx = firstHalf.reduce((minIdx, c, i, arr) => c.low < arr[minIdx].low ? i : minIdx, 0);
  const poleLow = firstHalf[poleLowIdx].low;
  const poleLowDate = firstHalf[poleLowIdx].date;
  
  const poleHighIdx = secondHalf.reduce((maxIdx, c, i, arr) => c.high > arr[maxIdx].high ? i : maxIdx, 0);
  const poleHigh = secondHalf[poleHighIdx].high;
  const poleHighDate = secondHalf[poleHighIdx].date;
  
  const gain = ((poleHigh - poleLow) / poleLow) * 100;
  
  // Relaxed: show if there was any meaningful gain (10%+)
  if (gain < 10) return null;
  
  // Flag period consolidation range
  const flagHigh = Math.max(...flagBars.map(c => c.high));
  const flagLow = Math.min(...flagBars.map(c => c.low));
  const avgPrice = flagBars.reduce((sum, c) => sum + c.close, 0) / flagBars.length;
  const rangePercent = ((flagHigh - flagLow) / avgPrice) * 100;
  
  // Relaxed: allow up to 25% range in the flag
  if (rangePercent > 25) return null;
  
  return {
    poleStart: new Date(poleLowDate).getTime() / 1000,
    poleLow,
    poleEnd: new Date(poleHighDate).getTime() / 1000,
    poleHigh,
    flagStart: new Date(flagBars[0].date).getTime() / 1000,
    flagEnd: new Date(flagBars[flagBars.length - 1].date).getTime() / 1000,
    flagHigh,
    flagLow
  };
}

interface CupAndHandleData {
  cupStart: number;
  lipLevel: number;
  cupBottomTime: number;
  cupBottomPrice: number;
  cupRightTime: number;
  handleStart: number;
  handleEnd: number;
  handleHigh: number;
  handleLow: number;
}

function detectCupAndHandle(
  data: { date: string; high: number; low: number; close: number; volume: number }[]
): CupAndHandleData | null {
  if (data.length < 25) return null;
  
  // For visualization, look for any cup-like pattern with more relaxed thresholds
  const lookback = data.slice(-60);
  if (lookback.length < 25) return null;
  
  // Find the highest point in first third as left lip
  const leftThird = lookback.slice(0, Math.floor(lookback.length / 3));
  const leftLipIdx = leftThird.reduce((maxIdx, c, i, arr) => c.high > arr[maxIdx].high ? i : maxIdx, 0);
  const leftLipHigh = leftThird[leftLipIdx].high;
  
  // Find the lowest point in middle third as cup bottom
  const middleStart = Math.floor(lookback.length / 3);
  const middleEnd = Math.floor(lookback.length * 2 / 3);
  const middleThird = lookback.slice(middleStart, middleEnd);
  const cupBottomIdx = middleThird.reduce((minIdx, c, i, arr) => c.low < arr[minIdx].low ? i : minIdx, 0);
  const cupBottom = middleThird[cupBottomIdx].low;
  const cupBottomDate = middleThird[cupBottomIdx].date;
  
  // Right third should approach the left lip level
  const rightThird = lookback.slice(Math.floor(lookback.length * 2 / 3));
  const rightHighIdx = rightThird.reduce((maxIdx, c, i, arr) => c.high > arr[maxIdx].high ? i : maxIdx, 0);
  const rightHighest = rightThird[rightHighIdx].high;
  const rightHighDate = rightThird[rightHighIdx].date;
  
  // Relaxed: cup depth 8-50% (was 15-40%)
  const cupDepth = ((leftLipHigh - cupBottom) / leftLipHigh) * 100;
  if (cupDepth < 8 || cupDepth > 50) return null;
  
  // Relaxed: right side within 15% of left lip (was 5%)
  if (rightHighest < leftLipHigh * 0.85) return null;
  
  // Last few bars as handle
  const handleBars = lookback.slice(-10);
  const handleHigh = Math.max(...handleBars.map(c => c.high));
  const handleLow = Math.min(...handleBars.map(c => c.low));
  
  return {
    cupStart: new Date(lookback[0].date).getTime() / 1000,
    lipLevel: leftLipHigh,
    cupBottomTime: new Date(cupBottomDate).getTime() / 1000,
    cupBottomPrice: cupBottom,
    cupRightTime: new Date(rightHighDate).getTime() / 1000,
    handleStart: new Date(handleBars[0].date).getTime() / 1000,
    handleEnd: new Date(handleBars[handleBars.length - 1].date).getTime() / 1000,
    handleHigh,
    handleLow
  };
}

type ToolMode = 'none' | 'measure' | 'line';

export function StockChart({ symbol, showChannels: initialShowChannels = false, selectedPattern }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [channels, setChannels] = useState<ConsolidationChannel[]>([]);
  const [interval, setInterval] = useState('1d');
  const [showChannels, setShowChannels] = useState(initialShowChannels);
  const [showPatternViz, setShowPatternViz] = useState(!!selectedPattern);
  const [toolMode, setToolMode] = useState<ToolMode>('none');
  const [lineDefinitions, setLineDefinitions] = useState<HorizontalLineDefinition[]>([]);
  const [measureStart, setMeasureStart] = useState<MeasurePoint | null>(null);
  const [measureResult, setMeasureResult] = useState<{ priceDiff: number; pctChange: number } | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  
  // Determine if we should show pattern visualization (for patterns with channel-like visualizations)
  const patternNeedsViz = selectedPattern && ['VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle'].includes(selectedPattern);
  
  const { data: history, isLoading, error } = useStockHistory(symbol, interval);
  
  // Update showChannels when prop changes
  useEffect(() => {
    setShowChannels(initialShowChannels);
  }, [initialShowChannels]);
  
  // Update showPatternViz when selectedPattern changes
  useEffect(() => {
    setShowPatternViz(!!selectedPattern && ['VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle'].includes(selectedPattern));
  }, [selectedPattern]);

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
    candlestickSeriesRef.current = candlestickSeries;

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

    // Show SMAs for all timeframes (SMA periods are in bars, so 5-period SMA on 5min chart = 5 bars)
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
    
    // Add VWAP line - orange thicker dotted line
    const isIntraday = ['1m', '5m', '15m', '30m', '60m'].includes(interval);
    const vwap = calculateVWAP(history, isIntraday);
    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#f97316', // Orange
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const vwapData = history.map((item, i) => ({
      time: (new Date(item.date).getTime() / 1000) as Time,
      value: vwap[i] ?? undefined,
    })).filter(d => d.value !== undefined) as { time: Time; value: number }[];
    vwapSeries.setData(vwapData);

    // Detect and draw channels if explicitly requested OR if pattern visualization is on for channel patterns
    const shouldShowChannelPatterns = showChannels || 
      (showPatternViz && selectedPattern && ['VCP', 'Weekly Tight', 'Monthly Tight'].includes(selectedPattern));
    
    if (shouldShowChannelPatterns) {
      const detectedChannels = detectConsolidationChannels(history);
      setChannels(detectedChannels);

      detectedChannels.forEach(channel => {
        const topLine = chart.addSeries(LineSeries, {
          color: '#3b82f6',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        topLine.setData([
          { time: channel.startTime as Time, value: channel.high },
          { time: channel.endTime as Time, value: channel.high },
        ]);

        const bottomLine = chart.addSeries(LineSeries, {
          color: '#3b82f6',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        bottomLine.setData([
          { time: channel.startTime as Time, value: channel.low },
          { time: channel.endTime as Time, value: channel.low },
        ]);
      });
    } else {
      setChannels([]);
    }
    
    // Draw High Tight Flag visualization (strong uptrend + pennant consolidation)
    if (showPatternViz && selectedPattern === 'High Tight Flag' && history.length > 20) {
      const htfData = detectHighTightFlag(history);
      if (htfData) {
        // Draw the pole (diagonal line showing strong upward move)
        const poleLine = chart.addSeries(LineSeries, {
          color: '#3b82f6',
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        poleLine.setData([
          { time: htfData.poleStart as Time, value: htfData.poleLow },
          { time: htfData.poleEnd as Time, value: htfData.poleHigh },
        ]);
        
        // Draw pennant consolidation - converging lines that meet at apex
        // Calculate the convergence point (where the lines meet)
        const midPrice = (htfData.flagHigh + htfData.flagLow) / 2;
        
        // Top line: starts at flagHigh, slopes down to midPrice at end
        const flagTopLine = chart.addSeries(LineSeries, {
          color: '#22c55e',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        flagTopLine.setData([
          { time: htfData.flagStart as Time, value: htfData.flagHigh },
          { time: htfData.flagEnd as Time, value: midPrice },
        ]);

        // Bottom line: starts at flagLow, slopes up to midPrice at end
        const flagBottomLine = chart.addSeries(LineSeries, {
          color: '#22c55e',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        flagBottomLine.setData([
          { time: htfData.flagStart as Time, value: htfData.flagLow },
          { time: htfData.flagEnd as Time, value: midPrice },
        ]);
      }
    }
    
    // Draw Cup and Handle visualization
    if (showPatternViz && selectedPattern === 'Cup and Handle' && history.length > 30) {
      const cupData = detectCupAndHandle(history);
      if (cupData) {
        // Draw the cup lip level (horizontal resistance)
        const cupLipLine = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        cupLipLine.setData([
          { time: cupData.cupStart as Time, value: cupData.lipLevel },
          { time: cupData.cupRightTime as Time, value: cupData.lipLevel },
        ]);
        
        // Draw the cup arc (U-shape from left lip to bottom to right side)
        // Create smooth arc using multiple points
        const arcPoints: { time: Time; value: number }[] = [];
        const totalDuration = cupData.cupRightTime - cupData.cupStart;
        const arcSegments = 20; // Number of segments for smooth curve
        
        for (let i = 0; i <= arcSegments; i++) {
          const t = i / arcSegments; // 0 to 1
          const timePoint = cupData.cupStart + (totalDuration * t);
          
          // Parabolic curve: y = 4 * depth * t * (1-t) where t is 0-1
          // This creates a U-shape going from lipLevel down to cupBottomPrice and back up
          const depth = cupData.lipLevel - cupData.cupBottomPrice;
          const curveValue = cupData.lipLevel - (4 * depth * t * (1 - t));
          
          arcPoints.push({
            time: timePoint as Time,
            value: curveValue
          });
        }
        
        const cupArcLine = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        cupArcLine.setData(arcPoints);
        
        // Draw handle channel
        const handleTopLine = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        handleTopLine.setData([
          { time: cupData.handleStart as Time, value: cupData.handleHigh },
          { time: cupData.handleEnd as Time, value: cupData.handleHigh },
        ]);
        
        const handleBottomLine = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        handleBottomLine.setData([
          { time: cupData.handleStart as Time, value: cupData.handleLow },
          { time: cupData.handleEnd as Time, value: cupData.handleLow },
        ]);
      }
    }
    
    // Recreate horizontal lines from definitions
    lineDefinitions.forEach(lineDef => {
      const lineSeries = chart.addSeries(LineSeries, {
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      });
      
      const firstTime = (new Date(history[0].date).getTime() / 1000) as Time;
      const lastTime = (new Date(history[history.length - 1].date).getTime() / 1000) as Time;
      
      lineSeries.setData([
        { time: firstTime, value: lineDef.price },
        { time: lastTime, value: lineDef.price },
      ]);
    });

    // For daily timeframe, zoom to ~8-9 months (about 180-200 candles) for better pattern visibility
    // For other timeframes, fit all content
    if (interval === '1d' && candleData.length > 200) {
      // Show last 200 candles for daily charts
      const visibleBars = 200;
      chart.timeScale().setVisibleLogicalRange({
        from: candleData.length - visibleBars,
        to: candleData.length
      });
    } else {
      chart.timeScale().fitContent();
    }

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
  }, [history, interval, showChannels, showPatternViz, selectedPattern, lineDefinitions]);
  
  // Handle chart clicks for tools
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current || !candlestickSeriesRef.current || !history || history.length === 0) return;
    
    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Use chart API to convert coordinates to price/time
    const timeScale = chart.timeScale();
    
    // Get price using series coordinate conversion
    let priceAtClick: number | null = series.coordinateToPrice(y) as number | null;
    
    // Fallback: calculate price from y position if API returns null
    if (priceAtClick === null) {
      const chartHeight = 450;
      const allPrices = history.map(h => [h.high, h.low]).flat();
      const minPrice = Math.min(...allPrices);
      const maxPrice = Math.max(...allPrices);
      const priceRange = maxPrice - minPrice;
      const padding = priceRange * 0.1;
      const adjustedMin = minPrice - padding;
      const adjustedMax = maxPrice + padding;
      const adjustedRange = adjustedMax - adjustedMin;
      priceAtClick = adjustedMax - (y / chartHeight) * adjustedRange;
    }
    
    if (priceAtClick === null) return;
    
    const finalPrice = priceAtClick as number;
    
    if (toolMode === 'line') {
      // Add horizontal line at clicked price - chart will recreate it via useEffect
      const lineId = `line-${Date.now()}`;
      setLineDefinitions(prev => [...prev, { id: lineId, price: finalPrice }]);
      setToolMode('none');
    } else if (toolMode === 'measure') {
      if (!measureStart) {
        setMeasureStart({ price: finalPrice });
        setMeasureResult(null);
      } else {
        const priceDiff = finalPrice - measureStart.price;
        const pctChange = (priceDiff / measureStart.price) * 100;
        setMeasureResult({ priceDiff, pctChange });
        setMeasureStart(null);
        setToolMode('none');
      }
    }
  }, [toolMode, history, measureStart]);
  
  // Delete a horizontal line (just remove from definitions, chart will rebuild)
  const deleteLine = useCallback((lineId: string) => {
    setLineDefinitions(prev => prev.filter(l => l.id !== lineId));
  }, []);
  
  // Clear all lines
  const clearAllLines = useCallback(() => {
    setLineDefinitions([]);
  }, []);

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
      {/* Header with legend and tools */}
      <div className="mb-4 flex justify-between items-start flex-wrap gap-4">
        <div>
          <h3 className="font-semibold text-foreground mb-2">Price History</h3>
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
              <span className="flex items-center gap-1">
                <span className="w-6 h-0.5 inline-block" style={{ borderTop: '2px dotted #f97316' }}></span>
                <span className="text-muted-foreground">VWAP</span>
              </span>
            </div>
          </div>
        </div>
        
        {/* Drawing Tools */}
        <div className="flex gap-2 items-center flex-wrap">
          <Button
            variant={showChannels ? "default" : "outline"}
            size="sm"
            onClick={() => setShowChannels(!showChannels)}
            className="gap-1"
            data-testid="button-toggle-channels"
          >
            <Layers className="w-4 h-4" />
            Channels
          </Button>
          {patternNeedsViz && (
            <Button
              variant={showPatternViz ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPatternViz(!showPatternViz)}
              className="gap-1"
              data-testid="button-toggle-pattern"
              aria-pressed={showPatternViz}
              data-state={showPatternViz ? "on" : "off"}
            >
              {showPatternViz ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              {selectedPattern}
            </Button>
          )}
          <Button
            variant={toolMode === 'measure' ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setToolMode(toolMode === 'measure' ? 'none' : 'measure');
              setMeasureStart(null);
              setMeasureResult(null);
            }}
            className="gap-1"
            data-testid="button-measure"
          >
            <Ruler className="w-4 h-4" />
            Measure
          </Button>
          <Button
            variant={toolMode === 'line' ? "default" : "outline"}
            size="sm"
            onClick={() => setToolMode(toolMode === 'line' ? 'none' : 'line')}
            className="gap-1"
            data-testid="button-line"
          >
            <Minus className="w-4 h-4" />
            Line
          </Button>
          {lineDefinitions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAllLines}
              className="gap-1 text-destructive"
              data-testid="button-clear-lines"
            >
              <Trash2 className="w-4 h-4" />
              Clear Lines
            </Button>
          )}
        </div>
      </div>
      
      {/* Tool status messages */}
      {toolMode === 'measure' && (
        <div className="mb-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
          {measureStart ? "Click second point to complete measurement" : "Click first point to start measuring"}
        </div>
      )}
      {toolMode === 'line' && (
        <div className="mb-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
          Click on chart to place a horizontal line
        </div>
      )}
      {measureResult && (
        <div className="mb-2 text-sm bg-primary/10 border border-primary/20 px-3 py-2 rounded-lg flex gap-4">
          <span>
            <span className="text-muted-foreground">Change:</span>{' '}
            <span className={measureResult.priceDiff >= 0 ? "text-green-500 font-mono" : "text-red-500 font-mono"}>
              {measureResult.priceDiff >= 0 ? '+' : ''}{measureResult.priceDiff.toFixed(2)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Percent:</span>{' '}
            <span className={measureResult.pctChange >= 0 ? "text-green-500 font-mono" : "text-red-500 font-mono"}>
              {measureResult.pctChange >= 0 ? '+' : ''}{measureResult.pctChange.toFixed(2)}%
            </span>
          </span>
        </div>
      )}
      
      {/* Horizontal lines list for deletion */}
      {lineDefinitions.length > 0 && (
        <div className="mb-2 flex gap-2 flex-wrap items-center">
          <span className="text-xs text-muted-foreground">Lines:</span>
          {lineDefinitions.map((line) => (
            <span
              key={line.id}
              onClick={() => deleteLine(line.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/50 bg-red-50 dark:bg-red-900/20 text-xs cursor-pointer hover-elevate"
              data-testid={`line-delete-${line.id}`}
            >
              <span className="text-red-500 font-mono">${line.price.toFixed(2)}</span>
              <Trash2 className="w-3 h-3 text-muted-foreground" />
            </span>
          ))}
        </div>
      )}
      
      <div 
        ref={chartContainerRef} 
        className={`w-full ${toolMode !== 'none' ? 'cursor-crosshair' : ''}`}
        onClick={handleChartClick}
        data-testid="chart-container" 
      />
      
      {/* Timeframe Selector */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground mr-2">Timeframe:</span>
        {TIMEFRAMES.map((tf) => (
          <Button
            key={tf.value}
            variant={interval === tf.value ? "default" : "outline"}
            size="sm"
            onClick={() => setInterval(tf.value)}
            data-testid={`button-timeframe-${tf.value}`}
          >
            {tf.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
