import { useEffect, useRef, useState, useCallback } from "react";
import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2, Layers, Ruler, Minus, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimeframeContext } from "@/context/TimeframeContext";
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
import { detectCupAndHandle as sharedDetectCupAndHandle, CupAndHandleResult } from "@shared/patternDetection";

interface StockChartProps {
  symbol: string;
  showChannels?: boolean;
  selectedPattern?: string;
  technicalSignal?: string;
  initialInterval?: '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo';
  pullbackUpPeriod?: number; // For pullback patterns: number of candles in the up period
}

interface HorizontalLineDefinition {
  id: string;
  price: number;
}

interface MeasurePoint {
  price: number;
}

type TimeframeValue = '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo';

const TIMEFRAMES: { label: string; value: TimeframeValue }[] = [
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

// Calculate VWAP using TradingView Auto settings approach
// Resets daily for both intraday and daily timeframes (session-based)
function calculateVWAP(data: { date: string; high: number; low: number; close: number; volume: number }[], isIntraday: boolean): (number | null)[] {
  const vwap: (number | null)[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = '';
  
  for (let i = 0; i < data.length; i++) {
    const itemDate = new Date(data[i].date);
    const dayKey = itemDate.toDateString();
    
    // Reset cumulative values at start of new day (session reset)
    if (dayKey !== currentDay) {
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

// Get the current Auto VWAP value (last value from session-based VWAP)
function getCurrentAutoVWAP(data: { date: string; high: number; low: number; close: number; volume: number }[]): number | null {
  if (data.length === 0) return null;
  const vwapValues = calculateVWAP(data, false);
  return vwapValues[vwapValues.length - 1];
}

// Calculate Anchored VWAP from 6-month low
function calculateAnchoredVWAP(data: { date: string; high: number; low: number; close: number; volume: number }[]): { values: (number | null)[], anchorIndex: number } {
  if (data.length === 0) return { values: [], anchorIndex: -1 };
  
  // Find data from last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  // Find the index of the lowest price within last 6 months
  let lowestPrice = Infinity;
  let anchorIndex = -1;
  
  for (let i = 0; i < data.length; i++) {
    const itemDate = new Date(data[i].date);
    if (itemDate >= sixMonthsAgo && data[i].low < lowestPrice) {
      lowestPrice = data[i].low;
      anchorIndex = i;
    }
  }
  
  if (anchorIndex === -1) {
    // Fallback: use lowest in entire dataset
    for (let i = 0; i < data.length; i++) {
      if (data[i].low < lowestPrice) {
        lowestPrice = data[i].low;
        anchorIndex = i;
      }
    }
  }
  
  // Calculate VWAP from anchor point forward
  const anchoredVwap: (number | null)[] = new Array(data.length).fill(null);
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = anchorIndex; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
    
    if (cumulativeVolume > 0) {
      anchoredVwap[i] = cumulativeTPV / cumulativeVolume;
    }
  }
  
  return { values: anchoredVwap, anchorIndex };
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

// Cup and Handle detection using shared module
// New interface matches the corrected pattern spec:
// - Cup starts at left peak (highest high before decline)
// - Cup arcs down to bottom (lowest low)
// - Cup arcs up to right rim (where handle pullback starts)
// - Handle follows candle LOWS
interface CupAndHandleData {
  leftPeakTime: number;
  leftPeakPrice: number;
  cupBottomTime: number;
  cupBottomPrice: number;
  rightRimTime: number;
  rightRimPrice: number;
  handleStartTime: number;
  handleEndTime: number;
  handleLows: { time: number; price: number }[];
  cupOnly: boolean;
  completionPct: number;
  extensionPct: number;
}

function detectCupAndHandleForChart(
  data: { date: string; open: number; high: number; low: number; close: number; volume: number }[],
  loose: boolean = true
): CupAndHandleData | null {
  // Use shared detection algorithm
  const result = sharedDetectCupAndHandle(data, loose);
  
  if (!result.detected || 
      !result.leftPeakTime || result.leftPeakPrice === undefined ||
      !result.cupBottomTime || result.cupBottomPrice === undefined ||
      !result.rightRimTime || result.rightRimPrice === undefined ||
      !result.handleStartTime || !result.handleEndTime || 
      !result.handleLows || result.handleLows.length === 0) {
    return null;
  }
  
  return {
    leftPeakTime: result.leftPeakTime,
    leftPeakPrice: result.leftPeakPrice,
    cupBottomTime: result.cupBottomTime,
    cupBottomPrice: result.cupBottomPrice,
    rightRimTime: result.rightRimTime,
    rightRimPrice: result.rightRimPrice,
    handleStartTime: result.handleStartTime,
    handleEndTime: result.handleEndTime,
    handleLows: result.handleLows,
    cupOnly: result.cupOnly || false,
    completionPct: result.completionPct || 0,
    extensionPct: result.extensionPct || 0
  };
}

type ToolMode = 'none' | 'measure' | 'line';

// Define available indicators for toggle functionality
type IndicatorKey = 'sma5' | 'sma10' | 'sma6' | 'sma20' | 'sma50' | 'sma200' | 'ema21' | 'sma3Month' | 'autoVwap' | 'anchoredVwap' | 'vwap12Week';

interface IndicatorConfig {
  key: IndicatorKey;
  label: string;
  color: string;
  colorClass: string;
}

// Get default enabled indicators based on signal/pattern AND timeframe
// Timeframe-specific defaults from user specs:
// 5min: 6,20,vwap dotted
// 15min: 20,5D
// 30min: 5d off,21d,50d off,vwap dotted
// 60min: 5d off,21d,50d,vwap dotted,AVWAP 6MOS
// Daily: 5,10 off,50,200,vwap dotted,AVWAP 6MOS
function getDefaultIndicators(technicalSignal?: string, selectedPattern?: string, timeframe?: string): Set<IndicatorKey> {
  const is620Cross = technicalSignal === '6_20_cross';
  const isRide21EMA = technicalSignal === 'ride_21_ema';
  const isPullback = technicalSignal?.startsWith('pullback_');
  const isPatternMode = selectedPattern && ['VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle'].includes(selectedPattern);
  
  // If specific signal type, use signal-based defaults
  if (is620Cross) {
    // 6/20 Cross: SMA 6 Pink, SMA 20 Blue, Session VWAP only
    return new Set(['sma6', 'sma20', 'autoVwap'] as IndicatorKey[]);
  }
  
  if (isRide21EMA || isPullback) {
    // Ride 21 EMA / Pullback: EMA 21 Pink, SMA 5 Green, SMA 10 Blue, SMA 50 Red, SMA 200 Black, AutoVWAP, Anchored VWAP
    return new Set(['ema21', 'sma5', 'sma10', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
  }
  
  if (isPatternMode) {
    // Patterns: Full set + 3 Month SMA (VCP doesn't get 12W VWAP)
    const patternIndicators: IndicatorKey[] = ['sma5', 'sma10', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap', 'sma3Month'];
    if (selectedPattern !== 'VCP') {
      patternIndicators.push('vwap12Week');
    }
    return new Set(patternIndicators);
  }
  
  // Timeframe-specific defaults when no specific signal/pattern
  switch (timeframe) {
    case '5m':
      // 5min: SMA 6, SMA 20, VWAP (dotted)
      return new Set(['sma6', 'sma20', 'autoVwap'] as IndicatorKey[]);
    case '15m':
      // 15min: SMA 20, SMA 5 (no VWAP by default)
      return new Set(['sma5', 'sma20'] as IndicatorKey[]);
    case '30m':
      // 30min: EMA 21, VWAP (5d and 50d available but off by default)
      return new Set(['ema21', 'autoVwap'] as IndicatorKey[]);
    case '60m':
      // 60min: EMA 21, SMA 50, VWAP, AVWAP 6MOS (5d available but off)
      return new Set(['ema21', 'sma50', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
    case '1d':
      // Daily: SMA 5, SMA 50, SMA 200, VWAP, AVWAP 6MOS (SMA 10 available but off)
      return new Set(['sma5', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
    case '1wk':
    case '1mo':
      // Weekly/Monthly: Full set
      return new Set(['sma5', 'sma10', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
    default:
      // Default: Daily set
      return new Set(['sma5', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
  }
}

export function StockChart({ symbol, showChannels: initialShowChannels = false, selectedPattern, technicalSignal, initialInterval, pullbackUpPeriod }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [channels, setChannels] = useState<ConsolidationChannel[]>([]);
  const { globalTimeframe, setGlobalTimeframe } = useTimeframeContext();
  
  // Track if user has manually changed the interval
  const [userSelectedInterval, setUserSelectedInterval] = useState(false);
  // Auto-select timeframe based on: URL param > globalTimeframe > technicalSignal > default
  const getDefaultInterval = () => {
    if (initialInterval) return initialInterval;
    if (technicalSignal === '6_20_cross') return '5m';
    // Use global timeframe if no special signal/pattern dictates otherwise
    return globalTimeframe;
  };
  const [interval, setIntervalState] = useState(getDefaultInterval());
  const [showChannels, setShowChannels] = useState(initialShowChannels);
  const [showPatternViz, setShowPatternViz] = useState(!!selectedPattern);
  const [toolMode, setToolMode] = useState<ToolMode>('none');
  const [lineDefinitions, setLineDefinitions] = useState<HorizontalLineDefinition[]>([]);
  const [measureStart, setMeasureStart] = useState<{ price: number; barIndex: number } | null>(null);
  const [measureResult, setMeasureResult] = useState<{ priceDiff: number; pctChange: number; barCount: number } | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  
  // Indicator toggles - initialized based on signal type and timeframe
  const [enabledIndicators, setEnabledIndicators] = useState<Set<IndicatorKey>>(() => 
    getDefaultIndicators(technicalSignal, selectedPattern, interval)
  );
  
  // Update enabled indicators when signal/pattern/timeframe changes
  useEffect(() => {
    setEnabledIndicators(getDefaultIndicators(technicalSignal, selectedPattern, interval));
  }, [technicalSignal, selectedPattern, interval]);
  
  const toggleIndicator = (key: IndicatorKey) => {
    setEnabledIndicators(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };
  
  // Wrapper to track user manual interval changes AND sync to global context
  const setInterval = (newInterval: '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo') => {
    setUserSelectedInterval(true);
    setIntervalState(newInterval);
    setGlobalTimeframe(newInterval); // Sync to global context
  };
  
  // Reset userSelectedInterval when signal/pattern changes to allow auto-switching
  useEffect(() => {
    setUserSelectedInterval(false);
  }, [technicalSignal, selectedPattern]);
  
  // Auto-switch timeframe based on signal/pattern (only if user hasn't manually changed it AND no initialInterval was provided)
  useEffect(() => {
    // Skip auto-switch if user manually changed interval or if an initialInterval was provided via URL
    if (userSelectedInterval || initialInterval) return;
    
    if (technicalSignal === '6_20_cross') {
      setIntervalState('5m');
    } else if (selectedPattern === 'Monthly Tight') {
      setIntervalState('1mo'); // Monthly chart for Monthly Tight
    } else {
      // Use global timeframe when no pattern/signal dictates otherwise
      setIntervalState(globalTimeframe);
    }
  }, [technicalSignal, selectedPattern, userSelectedInterval, initialInterval, globalTimeframe]);
  
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
    
    // Get timeframe label for watermark
    const getTimeframeLabel = (tf: string) => {
      const labels: Record<string, string> = {
        '1m': '1 Min', '5m': '5 Min', '15m': '15 Min', '30m': '30 Min', '60m': '1 Hour',
        '1d': 'Daily', '1wk': 'Weekly', '1mo': 'Monthly'
      };
      return labels[tf] || tf;
    };
    
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
    
    // Create watermark overlay
    const watermarkDiv = document.createElement('div');
    watermarkDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 48px;
      font-weight: bold;
      color: ${isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)'};
      pointer-events: none;
      user-select: none;
      z-index: 1;
    `;
    watermarkDiv.textContent = `${symbol} • ${getTimeframeLabel(interval)}`;
    watermarkDiv.className = 'chart-watermark';
    chartContainerRef.current.style.position = 'relative';
    // Remove any existing watermark
    chartContainerRef.current.querySelectorAll('.chart-watermark').forEach(el => el.remove());
    chartContainerRef.current.appendChild(watermarkDiv);

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

    // Calculate all indicators (will only display those that are enabled)
    const sma5 = calculateSMA(history, 5);
    const sma6 = calculateSMA(history, 6);
    const sma10 = calculateSMA(history, 10);
    const sma20 = calculateSMA(history, 20);
    const sma50 = calculateSMA(history, 50);
    const sma200 = calculateSMA(history, 200);
    const ema21 = calculateEMA(history, 21);
    const sma3Month = calculateSMA(history, 63); // ~3 months of trading days
    const isIntraday = ['1m', '5m', '15m', '30m', '60m'].includes(interval);
    const vwap = calculateVWAP(history, isIntraday);
    const anchoredVwapResult = calculateAnchoredVWAP(history);
    
    // Helper function to add indicator series
    const addIndicatorSeries = (values: (number | null)[], color: string, lineWidth: 1 | 2 | 3 | 4 = 1, lineStyle: number = LineStyle.Solid) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        lineStyle,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const data = history.map((item, i) => ({
        time: (new Date(item.date).getTime() / 1000) as Time,
        value: values[i] ?? undefined,
      })).filter(d => d.value !== undefined) as { time: Time; value: number }[];
      series.setData(data);
      return series;
    };
    
    // Add indicators based on enabledIndicators state
    // SMA 5 - Green
    if (enabledIndicators.has('sma5')) {
      addIndicatorSeries(sma5, '#22c55e', 1); // Green
    }
    
    // SMA 6 - Pink (for 6/20 Cross)
    if (enabledIndicators.has('sma6')) {
      addIndicatorSeries(sma6, '#f472b6', 2); // Pink
    }
    
    // SMA 10 - Blue
    if (enabledIndicators.has('sma10')) {
      addIndicatorSeries(sma10, '#3b82f6', 1); // Blue
    }
    
    // SMA 20 - Blue (thicker for 6/20 Cross)
    if (enabledIndicators.has('sma20')) {
      addIndicatorSeries(sma20, '#3b82f6', 3); // Blue, thick
    }
    
    // SMA 50 - Red
    if (enabledIndicators.has('sma50')) {
      addIndicatorSeries(sma50, '#dc2626', 2); // Red
    }
    
    // SMA 200 - Black/White
    if (enabledIndicators.has('sma200')) {
      addIndicatorSeries(sma200, isDark ? '#ffffff' : '#000000', 2);
    }
    
    // EMA 21 - Pink (thicker)
    if (enabledIndicators.has('ema21')) {
      addIndicatorSeries(ema21, '#f472b6', 3); // Pink, thick
    }
    
    // 3 Month SMA - Pink
    if (enabledIndicators.has('sma3Month')) {
      addIndicatorSeries(sma3Month, '#f472b6', 2); // Pink
    }
    
    // Auto VWAP - Orange dotted
    if (enabledIndicators.has('autoVwap')) {
      addIndicatorSeries(vwap, '#f97316', 2, LineStyle.Dotted);
    }
    
    // Anchored VWAP (6-month low) - Yellow solid thick
    if (enabledIndicators.has('anchoredVwap')) {
      addIndicatorSeries(anchoredVwapResult.values, 'rgba(234, 179, 8, 0.7)', 3);
    }
    
    // 12 Week VWAP (anchored to 8-month low) - Yellow thick
    if (enabledIndicators.has('vwap12Week')) {
      // Calculate 12-week VWAP anchored to 8-month low
      const eightMonthsAgo = new Date();
      eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
      let lowestPrice = Infinity;
      let anchorIdx = -1;
      for (let i = 0; i < history.length; i++) {
        const itemDate = new Date(history[i].date);
        if (itemDate >= eightMonthsAgo && history[i].low < lowestPrice) {
          lowestPrice = history[i].low;
          anchorIdx = i;
        }
      }
      if (anchorIdx !== -1) {
        const vwap12Week: (number | null)[] = [];
        let cumulativeTPV = 0;
        let cumulativeVolume = 0;
        for (let i = 0; i < history.length; i++) {
          if (i < anchorIdx) {
            vwap12Week.push(null);
          } else {
            const tp = (history[i].high + history[i].low + history[i].close) / 3;
            cumulativeTPV += tp * history[i].volume;
            cumulativeVolume += history[i].volume;
            vwap12Week.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null);
          }
        }
        addIndicatorSeries(vwap12Week, 'rgba(234, 179, 8, 0.9)', 3);
      }
    }

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
    
    // Draw Cup and Handle visualization - BRIGHT BLUE color for all elements
    const CUP_HANDLE_COLOR = '#3b82f6'; // Bright blue to distinguish from VWAP lines
    
    if (showPatternViz && selectedPattern === 'Cup and Handle' && history.length > 30) {
      const cupData = detectCupAndHandleForChart(history);
      if (cupData) {
        // Draw the cup arc: Left Peak → Cup Bottom → Right Rim
        // Arc goes from left peak (start of decline) down to bottom and up to right rim
        const arcPoints: { time: Time; value: number }[] = [];
        const totalDuration = cupData.rightRimTime - cupData.leftPeakTime;
        const arcSegments = 25; // Number of segments for smooth curve
        
        // Calculate where the bottom should be in the arc (as fraction of time)
        const bottomTimeOffset = cupData.cupBottomTime - cupData.leftPeakTime;
        const bottomFraction = bottomTimeOffset / totalDuration;
        
        for (let i = 0; i <= arcSegments; i++) {
          const t = i / arcSegments; // 0 to 1
          const timePoint = cupData.leftPeakTime + (totalDuration * t);
          
          // Use a modified parabola that goes through left peak, cup bottom, and right rim
          // The formula creates an asymmetric U-shape
          let curveValue: number;
          
          if (t <= bottomFraction) {
            // Left side: interpolate from left peak down to cup bottom
            const leftT = t / bottomFraction;
            curveValue = cupData.leftPeakPrice - (cupData.leftPeakPrice - cupData.cupBottomPrice) * Math.pow(leftT, 0.8);
          } else {
            // Right side: interpolate from cup bottom up to right rim
            const rightT = (t - bottomFraction) / (1 - bottomFraction);
            curveValue = cupData.cupBottomPrice + (cupData.rightRimPrice - cupData.cupBottomPrice) * Math.pow(rightT, 0.8);
          }
          
          arcPoints.push({
            time: timePoint as Time,
            value: curveValue
          });
        }
        
        const cupArcLine = chart.addSeries(LineSeries, {
          color: CUP_HANDLE_COLOR,
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        cupArcLine.setData(arcPoints);
        
        // Draw handle: follows actual candle LOWS from right rim down
        // Only draw if we have handle data and it's not a "Cup Only" pattern
        if (!cupData.cupOnly && cupData.handleLows.length > 1) {
          // Sort handle lows by time to ensure ascending order
          const sortedHandleLows = [...cupData.handleLows].sort((a, b) => a.time - b.time);
          
          // Connect right rim to first handle low
          if (cupData.rightRimTime < sortedHandleLows[0].time) {
            const connectorLine = chart.addSeries(LineSeries, {
              color: CUP_HANDLE_COLOR,
              lineWidth: 2,
              lineStyle: LineStyle.Solid,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            connectorLine.setData([
              { time: cupData.rightRimTime as Time, value: cupData.rightRimPrice },
              { time: sortedHandleLows[0].time as Time, value: sortedHandleLows[0].price },
            ]);
          }
          
          // Draw line along handle lows
          const handleLine = chart.addSeries(LineSeries, {
            color: CUP_HANDLE_COLOR,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          handleLine.setData(
            sortedHandleLows.map(h => ({ time: h.time as Time, value: h.price }))
          );
        }
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

    // Adjust visible range based on interval/signal/pattern type
    // Based on user screenshots:
    // 5m: ~117 bars (~1.5 trading days)
    // 15m: ~200 bars (~5-6 trading days)
    // 30m: ~160 bars (~10-12 trading days)
    // 60m: ~130 bars (~3-4 weeks)
    // Daily: ~200 bars (~8-9 months)
    // Weekly: ~156 bars (~3 years)
    // Monthly: show all available
    const isPatternMode = selectedPattern && ['VCP', 'Weekly Tight', 'High Tight Flag', 'Cup and Handle'].includes(selectedPattern);
    const isPullbackSignal = technicalSignal?.startsWith('pullback_');
    
    // Add right padding to ensure last bar is visible (add 3 bars of padding)
    const rightPadding = 3;
    
    // Determine visible bars based on timeframe
    const getVisibleBarsForInterval = (): number => {
      switch (interval) {
        case '5m': return 117;   // ~1.5 trading days
        case '15m': return 200;  // ~5-6 trading days
        case '30m': return 160;  // ~10-12 trading days
        case '60m': return 130;  // ~3-4 weeks
        case '1d': return 200;   // ~8-9 months
        case '1wk': return 156;  // ~3 years
        case '1mo': return candleData.length; // Show all for monthly
        default: return 200;
      }
    };
    
    // Special cases for signals/patterns
    if (isPullbackSignal && interval === '1d') {
      // Pullback patterns: show (upPeriodCandles × 5), minimum 30 bars
      const upPeriod = pullbackUpPeriod || 10; // Default to 10 if not provided
      const visibleBars = Math.max(30, upPeriod * 5);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candleData.length - visibleBars),
        to: candleData.length + rightPadding
      });
    } else if (interval === '1mo' && selectedPattern === 'Monthly Tight' && candleData.length > 24) {
      // Monthly Tight: 24 months viewable
      const visibleBars = 24;
      chart.timeScale().setVisibleLogicalRange({
        from: candleData.length - visibleBars,
        to: candleData.length + rightPadding
      });
    } else if (interval === '1d' && isPatternMode && candleData.length > 130) {
      // Patterns: 6 months viewable (~130 trading days)
      const visibleBars = 130;
      chart.timeScale().setVisibleLogicalRange({
        from: candleData.length - visibleBars,
        to: candleData.length + rightPadding
      });
    } else {
      // Use default visible bars for the interval
      const visibleBars = getVisibleBarsForInterval();
      if (candleData.length > visibleBars) {
        chart.timeScale().setVisibleLogicalRange({
          from: candleData.length - visibleBars,
          to: candleData.length + rightPadding
        });
      } else {
        chart.timeScale().fitContent();
      }
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
  }, [history, interval, showChannels, showPatternViz, selectedPattern, technicalSignal, lineDefinitions, enabledIndicators, symbol, pullbackUpPeriod]);
  
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
      // Limit to max 2 lines - if adding 3rd, remove the first one
      const lineId = `line-${Date.now()}`;
      setLineDefinitions(prev => {
        if (prev.length >= 2) {
          // Remove the oldest line (first one) when adding a 3rd
          return [...prev.slice(1), { id: lineId, price: finalPrice }];
        }
        return [...prev, { id: lineId, price: finalPrice }];
      });
      setToolMode('none');
    } else if (toolMode === 'measure') {
      // Get bar index from time coordinate
      const timeScale = chart.timeScale();
      const coordinate = timeScale.coordinateToLogical(x);
      const barIndex = Math.round(coordinate ?? 0);
      
      if (!measureStart) {
        setMeasureStart({ price: finalPrice, barIndex });
        setMeasureResult(null);
      } else {
        const priceDiff = finalPrice - measureStart.price;
        const pctChange = (priceDiff / measureStart.price) * 100;
        // Inclusive count: from first click to last click includes both bars
        const barCount = Math.abs(barIndex - measureStart.barIndex) + 1;
        setMeasureResult({ priceDiff, pctChange, barCount });
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
      {/* Header with legend toggle buttons and tools */}
      <div className="mb-4 flex justify-between items-start flex-wrap gap-4">
        <div>
          <h3 className="font-semibold text-foreground mb-2">Indicator Toggles</h3>
          <div className="flex gap-1 items-center flex-wrap">
            {/* Indicator toggle buttons - driven by enabledIndicators and signal/pattern context */}
            
            {/* 6/20 Cross specific: SMA 6 and SMA 20 */}
            {technicalSignal === '6_20_cross' && (
              <>
                <Button
                  variant={enabledIndicators.has('sma6') ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleIndicator('sma6')}
                  className="gap-1 h-7 px-2"
                  data-testid="toggle-sma6"
                >
                  <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: '#f472b6' }}></span>
                  <span className="text-xs">SMA 6</span>
                </Button>
                <Button
                  variant={enabledIndicators.has('sma20') ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleIndicator('sma20')}
                  className="gap-1 h-7 px-2"
                  data-testid="toggle-sma20"
                >
                  <span className="w-3 h-1 rounded" style={{ backgroundColor: '#3b82f6' }}></span>
                  <span className="text-xs">SMA 20</span>
                </Button>
              </>
            )}
            
            {/* EMA 21 for Ride 21 EMA and Pullback signals */}
            {(technicalSignal === 'ride_21_ema' || technicalSignal?.startsWith('pullback_')) && (
              <Button
                variant={enabledIndicators.has('ema21') ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleIndicator('ema21')}
                className="gap-1 h-7 px-2"
                data-testid="toggle-ema21"
              >
                <span className="w-3 h-1 rounded" style={{ backgroundColor: '#f472b6' }}></span>
                <span className="text-xs">EMA 21</span>
              </Button>
            )}
            
            {/* Standard SMAs for non-6/20 Cross modes */}
            {/* SMA 5 and 10 shown on all timeframes; SMA 50 and 200 only on daily/weekly/monthly */}
            {technicalSignal !== '6_20_cross' && (
              <>
                <Button
                  variant={enabledIndicators.has('sma5') ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleIndicator('sma5')}
                  className="gap-1 h-7 px-2"
                  data-testid="toggle-sma5"
                >
                  <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#22c55e' }}></span>
                  <span className="text-xs">SMA 5</span>
                </Button>
                <Button
                  variant={enabledIndicators.has('sma10') ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleIndicator('sma10')}
                  className="gap-1 h-7 px-2"
                  data-testid="toggle-sma10"
                >
                  <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#3b82f6' }}></span>
                  <span className="text-xs">SMA 10</span>
                </Button>
                {/* SMA 50 and 200 only on daily/weekly/monthly - NOT on intraday (5m, 15m, 30m, 60m) */}
                {['1d', '1wk', '1mo'].includes(interval) && (
                  <>
                    <Button
                      variant={enabledIndicators.has('sma50') ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => toggleIndicator('sma50')}
                      className="gap-1 h-7 px-2"
                      data-testid="toggle-sma50"
                    >
                      <span className="w-3 h-1 rounded" style={{ backgroundColor: '#dc2626' }}></span>
                      <span className="text-xs">SMA 50</span>
                    </Button>
                    <Button
                      variant={enabledIndicators.has('sma200') ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => toggleIndicator('sma200')}
                      className="gap-1 h-7 px-2"
                      data-testid="toggle-sma200"
                    >
                      <span className="w-3 h-0.5 rounded bg-black dark:bg-white"></span>
                      <span className="text-xs">SMA 200</span>
                    </Button>
                  </>
                )}
              </>
            )}
            
            {/* Pattern-specific indicators: 3 Month SMA (only on weekly/monthly), 12 Week VWAP (only on weekly, not VCP) */}
            {selectedPattern && ['VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle'].includes(selectedPattern) && (
              <>
                {/* 3M SMA only on weekly or monthly timeframes - NOT on daily or intraday */}
                {['1wk', '1mo'].includes(interval) && (
                  <Button
                    variant={enabledIndicators.has('sma3Month') ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleIndicator('sma3Month')}
                    className="gap-1 h-7 px-2"
                    data-testid="toggle-sma3month"
                  >
                    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#f472b6' }}></span>
                    <span className="text-xs">3M SMA</span>
                  </Button>
                )}
                {/* 12W VWAP only shows on weekly timeframe and not for VCP */}
                {interval === '1wk' && selectedPattern !== 'VCP' && (
                  <Button
                    variant={enabledIndicators.has('vwap12Week') ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleIndicator('vwap12Week')}
                    className="gap-1 h-7 px-2"
                    data-testid="toggle-vwap12week"
                  >
                    <span className="w-3 h-1 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.9)' }}></span>
                    <span className="text-xs">12W VWAP</span>
                  </Button>
                )}
              </>
            )}
            
            {/* VWAP (always shown) */}
            <Button
              variant={enabledIndicators.has('autoVwap') ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleIndicator('autoVwap')}
              className="gap-1 h-7 px-2"
              data-testid="toggle-autovwap"
            >
              <span className="w-4 h-0.5 inline-block" style={{ borderTop: '2px dotted #f97316' }}></span>
              <span className="text-xs">VWAP</span>
            </Button>
            
            {/* Anchored VWAP (not for 6/20 Cross) */}
            {technicalSignal !== '6_20_cross' && (
              <Button
                variant={enabledIndicators.has('anchoredVwap') ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleIndicator('anchoredVwap')}
                className="gap-1 h-7 px-2"
                data-testid="toggle-anchoredvwap"
              >
                <span className="w-4 h-1 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.7)' }}></span>
                <span className="text-xs">AVWAP LOW 6MOS</span>
              </Button>
            )}
            
            {/* Timeframe Selector - moved here after indicator toggles */}
            <span className="text-xs text-muted-foreground mx-2">|</span>
            {TIMEFRAMES.map((tf) => (
              <Button
                key={tf.value}
                variant={interval === tf.value ? "default" : "outline"}
                size="sm"
                onClick={() => setInterval(tf.value)}
                className="h-7 px-2"
                data-testid={`button-timeframe-${tf.value}`}
              >
                <span className="text-xs">{tf.label}</span>
              </Button>
            ))}
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
              variant="destructive"
              size="sm"
              onClick={clearAllLines}
              className="gap-1"
              data-testid="button-clear-lines"
            >
              <Trash2 className="w-4 h-4" />
              Clear Lines
            </Button>
          )}
        </div>
      </div>
      
      {/* Chart container - fixed height to prevent layout shift */}
      <div 
        ref={chartContainerRef} 
        className={`w-full h-[500px] ${toolMode !== 'none' ? 'cursor-crosshair' : ''}`}
        onClick={handleChartClick}
        data-testid="chart-container" 
      />
      
      {/* Tool status messages - moved BELOW chart to prevent layout shift */}
      {toolMode === 'measure' && (
        <div className="mt-2 text-sm text-white bg-white/20 border border-white/30 px-3 py-2 rounded-lg backdrop-blur-sm">
          {measureStart ? "Click second point to complete measurement" : "Click first point to start measuring"}
        </div>
      )}
      {toolMode === 'line' && (
        <div className="mt-2 text-sm text-white bg-white/20 border border-white/30 px-3 py-2 rounded-lg backdrop-blur-sm">
          Click on chart to place a horizontal line
        </div>
      )}
      {measureResult && (
        <div className="mt-2 text-sm bg-primary/10 border border-primary/20 px-3 py-2 rounded-lg flex gap-4 items-center">
          <span className="text-muted-foreground font-semibold">Measure:</span>
          <span>
            <span className="text-muted-foreground"># Bars:</span>{' '}
            <span className="text-foreground font-mono">{measureResult.barCount}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Change$:</span>{' '}
            <span className={measureResult.priceDiff >= 0 ? "text-green-500 font-mono" : "text-red-500 font-mono"}>
              {measureResult.priceDiff >= 0 ? '+' : ''}{measureResult.priceDiff.toFixed(2)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Change%:</span>{' '}
            <span className={measureResult.pctChange >= 0 ? "text-green-500 font-mono" : "text-red-500 font-mono"}>
              {measureResult.pctChange >= 0 ? '+' : ''}{measureResult.pctChange.toFixed(2)}%
            </span>
          </span>
        </div>
      )}
      
      {/* Horizontal lines list with diff calculation */}
      {lineDefinitions.length > 0 && (
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <span className="text-sm font-bold text-foreground">Lines:</span>
          {lineDefinitions.map((line) => (
            <span
              key={line.id}
              onClick={() => deleteLine(line.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-muted/50 text-xs cursor-pointer hover-elevate"
              data-testid={`line-delete-${line.id}`}
            >
              <span className="text-foreground font-mono">${line.price.toFixed(2)}</span>
              <Trash2 className="w-3 h-3 text-muted-foreground" />
            </span>
          ))}
          {/* Show diff calculation when exactly 2 lines exist */}
          {lineDefinitions.length === 2 && (() => {
            const [line1, line2] = lineDefinitions;
            const dollarDiff = line2.price - line1.price;
            const percentDiff = (dollarDiff / line1.price) * 100;
            const isPositive = dollarDiff >= 0;
            return (
              <span className={`inline-flex items-center gap-2 px-2 py-1 rounded border text-xs font-mono ${
                isPositive 
                  ? 'border-green-500/50 bg-green-50 dark:bg-green-900/20 text-green-500 font-bold' 
                  : 'border-red-500/50 bg-red-50 dark:bg-red-900/20 text-red-500 font-bold'
              }`}>
                <span>Dollar Diff: {isPositive ? '+' : ''}{dollarDiff.toFixed(2)}</span>
                <span>•</span>
                <span>Pct: {isPositive ? '+' : ''}{percentDiff.toFixed(2)}%</span>
              </span>
            );
          })()}
        </div>
      )}
      
    </div>
  );
}
