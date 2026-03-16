import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { getBarPeriod, DEFAULT_MA_TEMPLATE, BARS_PER_DAY } from "@shared/indicatorTemplates";

interface MaSettingFromConfig {
  rowId: string;
  title: string;
  maType: string;
  period: number | null;
  color: string;
  lineType: number;
  isSystem: boolean;
  isVisible: boolean;
  dailyOn: boolean;
  fiveMinOn: boolean;
  fifteenMinOn: boolean;
  thirtyMinOn: boolean;
  sortOrder: number;
  calcOn: string;
}

function getMaTimeframeToggle(setting: MaSettingFromConfig, timeframe: string): boolean {
  if (timeframe === "1d" || timeframe === "daily") return setting.dailyOn;
  if (timeframe === "5m" || timeframe === "5min") return setting.fiveMinOn;
  if (timeframe === "15m" || timeframe === "15min") return setting.fifteenMinOn;
  if (timeframe === "30m" || timeframe === "30min") return setting.thirtyMinOn;
  if (timeframe === "60m") return setting.thirtyMinOn;
  if (timeframe === "1wk" || timeframe === "1mo") return setting.dailyOn;
  return setting.dailyOn;
}

function getMaIndicatorKey(setting: MaSettingFromConfig): IndicatorKey | null {
  if (setting.maType === "vwap" || setting.maType === "vwap_hi" || setting.maType === "vwap_lo") return null;
  if (!setting.period) return null;
  const p = setting.period;
  if (setting.maType === "ema") {
    if (p === 21) return "ema21";
    return null;
  }
  if (p === 5) return "sma5";
  if (p === 6) return "sma6";
  if (p === 10) return "sma10";
  if (p === 20) return "sma20";
  if (p === 21) return "sma21";
  if (p === 50) return "sma50";
  if (p === 200) return "sma200";
  return null;
}

interface StockChartProps {
  symbol: string;
  showChannels?: boolean;
  selectedPattern?: string;
  technicalSignal?: string;
  initialInterval?: '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo';
  pullbackUpPeriod?: number; // For pullback patterns: number of candles in the up period
  // Dual-chart mode props
  chartMode?: 'daily-fixed' | 'variable'; // daily-fixed = locked to daily, no timeframe selector
  showToolsArea?: boolean; // Whether to show the tools (measure, line, channels) area
  chartHeight?: number; // Override chart height in pixels
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
  cupLows: { time: number; price: number }[]; // Bar lows for cup portion (support line)
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
  
  // Only require the 3 key points for the smooth parabolic curve
  if (!result.detected || 
      !result.leftPeakTime || result.leftPeakPrice === undefined ||
      !result.cupBottomTime || result.cupBottomPrice === undefined ||
      !result.rightRimTime || result.rightRimPrice === undefined ||
      !result.handleStartTime || !result.handleEndTime) {
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
    handleLows: result.handleLows || [],
    cupLows: result.cupLows || [],
    cupOnly: result.cupOnly || false,
    completionPct: result.completionPct || 0,
    extensionPct: result.extensionPct || 0
  };
}

type ToolMode = 'none' | 'measure' | 'line';

// Define available indicators for toggle functionality
type IndicatorKey = 'sma5' | 'sma10' | 'sma6' | 'sma20' | 'sma21' | 'sma50' | 'sma200' | 'ema21' | 'sma3Month' | 'autoVwap' | 'anchoredVwap' | 'vwap12Week' | 'vwap40Week';

interface IndicatorConfig {
  key: IndicatorKey;
  label: string;
  color: string;
  colorClass: string;
}

function getAvailableIndicatorsFromConfig(
  maSettings: MaSettingFromConfig[] | undefined,
  timeframe: string,
  isDailyFixed: boolean = false
): IndicatorKey[] {
  const maKeys: IndicatorKey[] = [];

  if (maSettings && maSettings.length > 0) {
    for (const s of maSettings) {
      if (!s.isVisible) continue;
      const key = getMaIndicatorKey(s);
      if (!key) continue;
      const tf = isDailyFixed ? "1d" : timeframe;
      if (!getMaTimeframeToggle(s, tf)) continue;
      if (!maKeys.includes(key)) maKeys.push(key);
    }
  } else {
    if (isDailyFixed) {
      return ['sma5', 'sma21', 'sma50', 'sma200'];
    }
    switch (timeframe) {
      case '5m':
        return ['sma6', 'sma20', 'sma50', 'autoVwap'];
      case '15m':
        return ['sma5', 'sma21', 'sma50', 'autoVwap'];
      case '30m':
        return ['sma5', 'sma21', 'sma50', 'autoVwap'];
      case '60m':
        return ['sma5', 'ema21', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'];
      case '1d':
        return ['sma5', 'sma10', 'sma20', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'];
      case '1wk':
      case '1mo':
        return ['sma21', 'sma50', 'sma200', 'vwap40Week', 'anchoredVwap'];
      default:
        return ['sma5', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'];
    }
  }

  const vwapKeys = getVwapKeysForTimeframe(timeframe, isDailyFixed);
  return [...maKeys, ...vwapKeys];
}

function getVwapKeysForTimeframe(timeframe: string, isDailyFixed: boolean): IndicatorKey[] {
  if (isDailyFixed) return [];
  switch (timeframe) {
    case '5m':
    case '15m':
    case '30m':
      return ['autoVwap'];
    case '60m':
      return ['autoVwap', 'anchoredVwap'];
    case '1d':
      return ['autoVwap', 'anchoredVwap'];
    case '1wk':
    case '1mo':
      return ['vwap40Week', 'anchoredVwap'];
    default:
      return ['autoVwap', 'anchoredVwap'];
  }
}

function getMaColorForKey(key: IndicatorKey, maSettings: MaSettingFromConfig[] | undefined): { color: string; lineType: number; label: string } | null {
  if (!maSettings) return null;
  for (const s of maSettings) {
    if (getMaIndicatorKey(s) === key) {
      return { color: s.color, lineType: s.lineType, label: s.title };
    }
  }
  return null;
}

function getDefaultIndicatorsFallback(timeframe?: string, isDailyFixed: boolean = false): Set<IndicatorKey> {
  if (isDailyFixed) {
    return new Set(['sma5', 'sma21', 'sma50', 'sma200'] as IndicatorKey[]);
  }
  switch (timeframe) {
    case '5m':
      return new Set(['sma6', 'sma20', 'sma50'] as IndicatorKey[]);
    case '15m':
      return new Set(['sma5', 'sma21', 'sma50', 'autoVwap'] as IndicatorKey[]);
    case '30m':
      return new Set(['sma5', 'sma21', 'sma50', 'autoVwap'] as IndicatorKey[]);
    case '60m':
      return new Set(['ema21', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
    case '1d':
      return new Set(['sma5', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
    case '1wk':
    case '1mo':
      return new Set(['sma21', 'sma50', 'sma200', 'vwap40Week', 'anchoredVwap'] as IndicatorKey[]);
    default:
      return new Set(['sma5', 'sma50', 'sma200', 'autoVwap', 'anchoredVwap'] as IndicatorKey[]);
  }
}

export function StockChart({ 
  symbol, 
  showChannels: initialShowChannels = false, 
  selectedPattern, 
  technicalSignal, 
  initialInterval, 
  pullbackUpPeriod,
  chartMode = 'variable',
  showToolsArea = true,
  chartHeight = 500
}: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [channels, setChannels] = useState<ConsolidationChannel[]>([]);
  const { globalTimeframe, setGlobalTimeframe } = useTimeframeContext();
  
  const isDailyFixed = chartMode === 'daily-fixed';
  
  const { data: maSettingsData } = useQuery<MaSettingFromConfig[]>({
    queryKey: ['/api/sentinel/ma-settings'],
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  
  const [userSelectedInterval, setUserSelectedInterval] = useState(false);
  const getDefaultInterval = () => {
    if (isDailyFixed) return '1d';
    if (initialInterval) return initialInterval;
    if (technicalSignal === '6_20_cross') return '5m';
    return globalTimeframe;
  };
  const [interval, setIntervalState] = useState(getDefaultInterval());
  const [showChannels, setShowChannels] = useState(initialShowChannels);
  const [showPatternViz, setShowPatternViz] = useState(!!selectedPattern);
  const [showGaps, setShowGaps] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('none');
  const [lineDefinitions, setLineDefinitions] = useState<HorizontalLineDefinition[]>([]);
  const [measureStart, setMeasureStart] = useState<{ price: number; barIndex: number } | null>(null);
  const [measureResult, setMeasureResult] = useState<{ priceDiff: number; pctChange: number; barCount: number } | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  
  const configAvailable = useMemo(() => getAvailableIndicatorsFromConfig(maSettingsData, interval, isDailyFixed), [maSettingsData, interval, isDailyFixed]);

  const [enabledIndicators, setEnabledIndicators] = useState<Set<IndicatorKey>>(() => 
    getDefaultIndicatorsFallback(interval, isDailyFixed)
  );
  
  useEffect(() => {
    if (maSettingsData && maSettingsData.length > 0) {
      const available = getAvailableIndicatorsFromConfig(maSettingsData, interval, isDailyFixed);
      setEnabledIndicators(new Set(available));
    } else {
      setEnabledIndicators(getDefaultIndicatorsFallback(interval, isDailyFixed));
    }
  }, [interval, isDailyFixed, maSettingsData]);
  
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
  // Also skip for daily-fixed mode which is always locked to '1d'
  useEffect(() => {
    // Skip auto-switch for daily-fixed mode or if user manually changed interval or if an initialInterval was provided
    if (isDailyFixed || userSelectedInterval || initialInterval) return;
    
    if (technicalSignal === '6_20_cross') {
      setIntervalState('5m');
    } else if (selectedPattern === 'Monthly Tight') {
      setIntervalState('1mo'); // Monthly chart for Monthly Tight
    } else {
      // Use global timeframe when no pattern/signal dictates otherwise
      setIntervalState(globalTimeframe);
    }
  }, [technicalSignal, selectedPattern, userSelectedInterval, initialInterval, globalTimeframe, isDailyFixed]);
  
  // Determine if we should show pattern visualization (for patterns with channel-like visualizations)
  const patternNeedsViz = selectedPattern && ['VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle'].includes(selectedPattern);
  
  const { data: history, isLoading, error, refetch } = useStockHistory(symbol, interval);
  
  // Force refetch intraday (5m/15m/30m/60m) every minute so chart gets new bars regardless of React Query timer
  useEffect(() => {
    const intraday = ['1m', '5m', '15m', '30m', '60m'].includes(interval);
    if (!intraday) return;
    const id = setInterval(() => refetch(), 60_000);
    return () => clearInterval(id);
  }, [interval, refetch]);
  
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
        rightOffset: 15, // Prevent bars from being cut off on right side
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

    // Calculate all indicators using timeframe-converted periods from shared template
    const p5  = getBarPeriod(5, interval);
    const p10 = getBarPeriod(10, interval);
    const p20 = getBarPeriod(20, interval);
    const p21 = getBarPeriod(21, interval);
    const p50 = getBarPeriod(50, interval);
    const p200 = getBarPeriod(200, interval);

    const sma5 = calculateSMA(history, p5);
    const sma6 = calculateSMA(history, getBarPeriod(6, interval));
    const sma10 = calculateSMA(history, p10);
    const sma20 = calculateSMA(history, p20);
    const sma21 = calculateSMA(history, p21);
    const sma50 = calculateSMA(history, p50);
    const sma200 = calculateSMA(history, p200);
    const ema21 = calculateEMA(history, p21);
    const sma3Month = calculateSMA(history, getBarPeriod(63, interval));
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
    
    const LINE_TYPE_MAP: Record<number, number> = {
      0: LineStyle.Solid, 1: LineStyle.Dashed, 2: LineStyle.Dotted,
      3: LineStyle.LargeDashed, 4: LineStyle.SparseDotted,
    };

    const tpl5   = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma5");
    const tpl10  = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma10");
    const tpl20  = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma20");
    const tpl50  = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma50");
    const tpl200 = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma200");

    const cfgColor = (key: IndicatorKey, fallbackColor: string, fallbackWidth: 1 | 2 | 3 | 4 = 1): { c: string; w: 1 | 2 | 3 | 4; ls: number } => {
      const cfg = getMaColorForKey(key, maSettingsData);
      if (cfg) return { c: cfg.color, w: fallbackWidth, ls: LINE_TYPE_MAP[cfg.lineType] ?? LineStyle.Solid };
      return { c: fallbackColor, w: fallbackWidth, ls: LineStyle.Solid };
    };

    if (enabledIndicators.has('sma5')) {
      const s = cfgColor('sma5', tpl5?.color ?? '#22c55e', tpl5?.lineWidth ?? 1);
      addIndicatorSeries(sma5, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('sma6')) {
      const s = cfgColor('sma6', '#f472b6', 2);
      addIndicatorSeries(sma6, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('sma10')) {
      const s = cfgColor('sma10', tpl10?.color ?? '#3b82f6', tpl10?.lineWidth ?? 1);
      addIndicatorSeries(sma10, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('sma20')) {
      const s = cfgColor('sma20', tpl20?.color ?? '#f472b6', tpl20?.lineWidth ?? 2);
      addIndicatorSeries(sma20, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('sma50')) {
      const s = cfgColor('sma50', tpl50?.color ?? '#dc2626', tpl50?.lineWidth ?? 2);
      addIndicatorSeries(sma50, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('sma200')) {
      const s = cfgColor('sma200', tpl200?.color ?? '#ffffff', tpl200?.lineWidth ?? 2);
      addIndicatorSeries(sma200, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('ema21')) {
      const s = cfgColor('ema21', tpl20?.color ?? '#f472b6', 3);
      addIndicatorSeries(ema21, s.c, s.w, s.ls);
    }
    
    if (enabledIndicators.has('sma21')) {
      const s = cfgColor('sma21', tpl20?.color ?? '#f472b6', 2);
      addIndicatorSeries(sma21, s.c, s.w, s.ls);
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
    
    // 40 Week VWAP (for weekly/monthly) - Yellow thick
    if (enabledIndicators.has('vwap40Week')) {
      // Calculate 40-week VWAP (approximately 40 weeks = ~10 months back)
      const tenMonthsAgo = new Date();
      tenMonthsAgo.setMonth(tenMonthsAgo.getMonth() - 10);
      let lowestPrice = Infinity;
      let anchorIdx = -1;
      for (let i = 0; i < history.length; i++) {
        const itemDate = new Date(history[i].date);
        if (itemDate >= tenMonthsAgo && history[i].low < lowestPrice) {
          lowestPrice = history[i].low;
          anchorIdx = i;
        }
      }
      if (anchorIdx !== -1) {
        const vwap40Week: (number | null)[] = [];
        let cumulativeTPV = 0;
        let cumulativeVolume = 0;
        for (let i = 0; i < history.length; i++) {
          if (i < anchorIdx) {
            vwap40Week.push(null);
          } else {
            const tp = (history[i].high + history[i].low + history[i].close) / 3;
            cumulativeTPV += tp * history[i].volume;
            cumulativeVolume += history[i].volume;
            vwap40Week.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null);
          }
        }
        addIndicatorSeries(vwap40Week, 'rgba(234, 179, 8, 0.9)', 3);
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
    
    // Draw Cup and Handle visualization - MarketSurge style smooth parabolic curve
    const CUP_HANDLE_COLOR = '#3b82f6'; // Bright blue
    
    if (showPatternViz && selectedPattern === 'Cup and Handle' && history.length > 30) {
      const cupData = detectCupAndHandleForChart(history);
      if (cupData) {
        // MarketSurge style: Draw a SMOOTH PARABOLIC CURVE connecting:
        // 1. Left peak (left rim of cup)
        // 2. Cup bottom (lowest point)
        // 3. Right rim (where handle starts)
        
        // Generate smooth U-shaped curve using quadratic interpolation
        // The parabola passes through all 3 key points
        const leftTime = cupData.leftPeakTime;
        const bottomTime = cupData.cupBottomTime;
        const rightTime = cupData.rightRimTime;
        
        const leftPrice = cupData.leftPeakPrice;
        const bottomPrice = cupData.cupBottomPrice;
        const rightPrice = cupData.rightRimPrice;
        
        // Generate 30 points along the smooth curve
        const NUM_POINTS = 30;
        const cupCurvePoints: { time: Time; value: number }[] = [];
        
        for (let i = 0; i <= NUM_POINTS; i++) {
          const t = i / NUM_POINTS; // 0 to 1
          
          // Quadratic Bezier-style interpolation for smooth U-shape
          // Control point is at the bottom of the cup
          // P(t) = (1-t)^2 * P0 + 2*(1-t)*t * P1 + t^2 * P2
          // where P0 = left peak, P1 = bottom (control), P2 = right rim
          
          const timeValue = (1 - t) * (1 - t) * leftTime + 2 * (1 - t) * t * bottomTime + t * t * rightTime;
          const priceValue = (1 - t) * (1 - t) * leftPrice + 2 * (1 - t) * t * bottomPrice + t * t * rightPrice;
          
          cupCurvePoints.push({
            time: timeValue as Time,
            value: priceValue
          });
        }
        
        const cupCurveLine = chart.addSeries(LineSeries, {
          color: CUP_HANDLE_COLOR,
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        cupCurveLine.setData(cupCurvePoints);
        
        // Draw horizontal lip line at the right rim level
        const lipLine = chart.addSeries(LineSeries, {
          color: CUP_HANDLE_COLOR,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        lipLine.setData([
          { time: leftTime as Time, value: Math.max(leftPrice, rightPrice) },
          { time: rightTime as Time, value: Math.max(leftPrice, rightPrice) }
        ]);
        
        // Draw handle as a small consolidation channel
        if (!cupData.cupOnly && cupData.handleLows && cupData.handleLows.length > 0) {
          // Sort handle lows by time
          const sortedHandleLows = [...cupData.handleLows].sort((a, b) => a.time - b.time);
          
          // Find handle high (approximately at right rim level) and handle low
          const handleLow = Math.min(...sortedHandleLows.map(h => h.price));
          const handleHigh = cupData.rightRimPrice; // Handle top is at the rim level
          
          // Draw handle as two parallel lines (channel)
          const handleStartTime = cupData.rightRimTime;
          const handleEndTime = cupData.handleEndTime;
          
          // Top of handle channel (horizontal at rim level, slight downslope allowed)
          const handleTopLine = chart.addSeries(LineSeries, {
            color: CUP_HANDLE_COLOR,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          handleTopLine.setData([
            { time: handleStartTime as Time, value: handleHigh },
            { time: handleEndTime as Time, value: handleHigh * 0.98 } // Slight downslope
          ]);
          
          // Bottom of handle channel (support line)
          const handleBottomLine = chart.addSeries(LineSeries, {
            color: CUP_HANDLE_COLOR,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          handleBottomLine.setData([
            { time: handleStartTime as Time, value: handleLow * 1.01 }, // Slight offset from rim
            { time: handleEndTime as Time, value: handleLow }
          ]);
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
    
    // Add right padding to ensure last bar is fully visible
    const rightPadding = 15;
    
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
  }, [history, interval, showChannels, showPatternViz, selectedPattern, technicalSignal, lineDefinitions, enabledIndicators, symbol, pullbackUpPeriod, maSettingsData]);
  
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
          <h3 className="font-semibold text-foreground mb-2">
            {isDailyFixed ? 'Daily Chart' : 'Indicator Toggles'}
          </h3>
          <div className="flex gap-1 items-center flex-wrap">
            {configAvailable.map((key) => {
              const cfg = getMaColorForKey(key, maSettingsData);
              const _tpl5   = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma5");
              const _tpl10  = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma10");
              const _tpl20  = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma20");
              const _tpl50  = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma50");
              const _tpl200 = DEFAULT_MA_TEMPLATE.find(t => t.id === "ma200");
              const fallbackStyles: Record<IndicatorKey, { color: string; label: string; isDotted?: boolean }> = {
                sma5: { color: _tpl5?.color ?? '#22c55e', label: `${_tpl5?.label ?? '5 Day'} SMA` },
                sma6: { color: '#f472b6', label: 'SMA 6' },
                sma10: { color: _tpl10?.color ?? '#3b82f6', label: `${_tpl10?.label ?? '10 Day'} SMA` },
                sma20: { color: _tpl20?.color ?? '#f472b6', label: `${_tpl20?.label ?? '20 Day'} SMA` },
                sma21: { color: _tpl20?.color ?? '#f472b6', label: `${_tpl20?.label ?? '20 Day'} SMA` },
                sma50: { color: _tpl50?.color ?? '#dc2626', label: `${_tpl50?.label ?? '50 Day'} SMA` },
                sma200: { color: _tpl200?.color ?? '#000000', label: `${_tpl200?.label ?? '200 Day'} SMA` },
                ema21: { color: _tpl20?.color ?? '#f472b6', label: `${_tpl20?.label ?? '20 Day'} EMA` },
                sma3Month: { color: '#f472b6', label: '3M SMA' },
                autoVwap: { color: '#f97316', label: 'VWAP', isDotted: true },
                anchoredVwap: { color: 'rgba(234, 179, 8, 0.7)', label: 'AVWAP 6MOS' },
                vwap12Week: { color: 'rgba(234, 179, 8, 0.9)', label: '12W VWAP' },
                vwap40Week: { color: 'rgba(234, 179, 8, 0.9)', label: '40W VWAP' },
              };
              const fallback = fallbackStyles[key];
              const displayColor = cfg ? cfg.color : fallback.color;
              const displayLabel = cfg ? cfg.label : fallback.label;
              const isDotted = cfg ? (cfg.lineType === 2 || cfg.lineType === 4) : !!fallback.isDotted;
              const isSma200 = key === 'sma200';
              
              return (
                <Button
                  key={key}
                  variant={enabledIndicators.has(key) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleIndicator(key)}
                  className="gap-1 h-7 px-2"
                  data-testid={`toggle-${key}`}
                >
                  {isDotted ? (
                    <span className="w-4 h-0.5 inline-block" style={{ borderTop: `2px dotted ${displayColor}` }}></span>
                  ) : isSma200 && !cfg ? (
                    <span className="w-3 h-0.5 rounded bg-black dark:bg-white"></span>
                  ) : (
                    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: displayColor }}></span>
                  )}
                  <span className="text-xs">{displayLabel}</span>
                </Button>
              );
            })}
            
            {/* Timeframe Selector - only for variable mode, hidden in daily-fixed mode */}
            {!isDailyFixed && (
              <>
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
              </>
            )}
          </div>
        </div>
        
        {/* Drawing Tools - hidden in daily-fixed mode unless showToolsArea is true */}
        {showToolsArea && (
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
          {interval === '1d' && (
            <Button
              variant={showGaps ? "default" : "outline"}
              size="sm"
              onClick={() => setShowGaps(!showGaps)}
              className="gap-1"
              data-testid="button-toggle-gaps"
            >
              <span className="text-xs font-bold">S/R</span>
              Gaps
            </Button>
          )}
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
        )}
      </div>
      
      {/* Chart container - dynamic height based on prop */}
      <div 
        ref={chartContainerRef} 
        className={`w-full ${toolMode !== 'none' ? 'cursor-crosshair' : ''}`}
        style={{ height: `${chartHeight}px` }}
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
            <span className={measureResult.priceDiff >= 0 ? "text-rs-green font-mono" : "text-rs-red font-mono"}>
              {measureResult.priceDiff >= 0 ? '+' : ''}{measureResult.priceDiff.toFixed(2)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Change%:</span>{' '}
            <span className={measureResult.pctChange >= 0 ? "text-rs-green font-mono" : "text-rs-red font-mono"}>
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
                  ? 'border-rs-green/50 bg-green-50 dark:bg-green-900/20 text-rs-green font-bold' 
                  : 'border-rs-red/50 bg-red-50 dark:bg-red-900/20 text-rs-red font-bold'
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
