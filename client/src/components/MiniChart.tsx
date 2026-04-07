import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
// Cup and Handle detection removed - thumbnails just show candlesticks

export type StartHereInterval = "1d" | "5m" | "15m";

interface MiniChartProps {
  symbol: string;
  timeframe?: string;
  technicalSignal?: string;
  crossDirection?: string;
  chartPattern?: string;
  /** Daily 21 / 50 / 200 SMA overlay (e.g. Start Here chart preview). */
  movingAverages2150200?: boolean;
  /**
   * With `movingAverages2150200`: `1d` = daily candles + SMAs; `5m` / `15m` = intraday + session VWAP (no MAs).
   */
  startHereInterval?: StartHereInterval;
  /** Stretch to parent height (resizable grid cells); chart area uses flex-1. */
  fillContainer?: boolean;
}

type MiniChartOhlcPayload = {
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;
};

/**
 * Recharts range-bar shape: OHLC body (open–close) plus vertical wick (high–low).
 * Maps wick extremes using the same price scale as the computed body rectangle.
 */
function MiniChartCandleShape(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  payload?: MiniChartOhlcPayload;
  fill?: string;
}) {
  const x = Number(props.x);
  const y = Number(props.y);
  const width = Number(props.width);
  const rawH = Number(props.height);
  const topPx = Math.min(y, y + rawH);
  const botPx = Math.max(y, y + rawH);
  const bodyHeightPx = Math.max(botPx - topPx, 1);
  const payload = props.payload;
  const fill = payload?.color ?? props.fill ?? "#94a3b8";
  if (!payload || ![payload.open, payload.high, payload.low, payload.close].every(Number.isFinite)) {
    return null;
  }
  const { open, high, low, close } = payload;
  const bodyTopPrice = Math.max(open, close);
  const bodyBotPrice = Math.min(open, close);
  const cx = x + width / 2;
  const priceBodySpan = bodyTopPrice - bodyBotPrice;

  let yHigh: number;
  let yLow: number;

  if (priceBodySpan < 1e-10) {
    const wickSpan = Math.max(high - low, 1e-9);
    const mapWick = (p: number) => topPx + ((high - p) / wickSpan) * bodyHeightPx;
    yHigh = mapWick(high);
    yLow = mapWick(low);
    const yMid = mapWick(open);
    return (
      <g>
        <line
          x1={cx}
          y1={yHigh}
          x2={cx}
          y2={yLow}
          stroke={fill}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x}
          y1={yMid}
          x2={x + width}
          y2={yMid}
          stroke={fill}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  const priceToY = (p: number) =>
    topPx + ((bodyTopPrice - p) / priceBodySpan) * (botPx - topPx);
  yHigh = priceToY(high);
  yLow = priceToY(low);

  return (
    <g>
      <line
        x1={cx}
        y1={yHigh}
        x2={cx}
        y2={yLow}
        stroke={fill}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <rect x={x} y={topPx} width={width} height={botPx - topPx} fill={fill} />
    </g>
  );
}

function calculateSMA(data: { close: number }[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, d) => acc + d.close, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

function sessionDateKeyEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

type VwapBar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Cumulative session VWAP (typical price × volume); resets each ET session. */
function calculateSessionVwap(bars: VwapBar[]): (number | null)[] {
  let cumPv = 0;
  let cumVol = 0;
  let sessionKey: string | null = null;
  const out: (number | null)[] = [];
  for (const bar of bars) {
    const key = sessionDateKeyEt(bar.date);
    if (key !== sessionKey) {
      sessionKey = key;
      cumPv = 0;
      cumVol = 0;
    }
    const h = Number(bar.high);
    const l = Number(bar.low);
    const c = Number(bar.close);
    const tp = (h + l + c) / 3;
    const v = Math.max(Number(bar.volume) || 0, 0);
    cumPv += tp * v;
    cumVol += v;
    out.push(cumVol > 0 ? cumPv / cumVol : null);
  }
  return out;
}

/** % change for the most recent session in the slice (last close vs that session’s first open). */
function sessionChangePct(bars: VwapBar[]): number {
  if (bars.length < 1) return 0;
  const lastKey = sessionDateKeyEt(bars[bars.length - 1].date);
  let i = bars.length - 1;
  while (i > 0 && sessionDateKeyEt(bars[i - 1].date) === lastKey) i--;
  const open = bars[i].open;
  const lastClose = bars[bars.length - 1].close;
  return open > 0 ? ((lastClose - open) / open) * 100 : 0;
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

interface ConsolidationChannel {
  startDate: string;
  endDate: string;
  high: number;
  low: number;
  type: string;
}

function detectConsolidationChannels(
  data: { date: string; high: number; low: number; close: number; volume: number }[],
  patternTimeframe: string
): ConsolidationChannel[] {
  const channels: ConsolidationChannel[] = [];
  
  if (data.length < 5) return channels;
  
  if (patternTimeframe === '20D' || patternTimeframe === 'all') {
    const weeklyData = data.slice(-20);
    if (weeklyData.length >= 5) {
      const weeklyHigh = Math.max(...weeklyData.map(c => c.high));
      const weeklyLow = Math.min(...weeklyData.map(c => c.low));
      const avgPrice = weeklyData.reduce((sum, c) => sum + c.close, 0) / weeklyData.length;
      const rangePercent = ((weeklyHigh - weeklyLow) / avgPrice) * 100;
      
      if (rangePercent <= 12) {
        channels.push({
          startDate: weeklyData[0].date,
          endDate: weeklyData[weeklyData.length - 1].date,
          high: weeklyHigh,
          low: weeklyLow,
          type: 'Weekly Tight'
        });
      }
    }
  }
  
  if (patternTimeframe === '60D' || patternTimeframe === 'all') {
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
            startDate: monthlyData[0].date,
            endDate: monthlyData[monthlyData.length - 1].date,
            high: monthlyHigh,
            low: monthlyLow,
            type: 'Monthly Tight'
          });
        }
      }
    }
  }
  
  if (patternTimeframe === '30D' || patternTimeframe === 'all') {
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
          startDate: period3[0].date,
          endDate: period3[period3.length - 1].date,
          high: vcpHigh,
          low: vcpLow,
          type: 'VCP'
        });
      }
    }
  }
  
  return channels;
}

export function MiniChart({
  symbol,
  timeframe = '30D',
  technicalSignal,
  crossDirection,
  chartPattern,
  movingAverages2150200,
  startHereInterval = '1d',
  fillContainer,
}: MiniChartProps) {
  const historyInterval = movingAverages2150200 ? startHereInterval : '1d';
  const { data: history, isLoading, error } = useStockHistory(symbol, historyInterval);

  const loadingShell = fillContainer
    ? "flex min-h-[120px] w-full flex-1 items-center justify-center rounded-md bg-card/50"
    : "h-[180px] w-full flex items-center justify-center bg-card rounded-lg border border-border";

  if (isLoading) {
    return (
      <div className={loadingShell} data-testid={`chart-loading-${symbol}`}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !history || history.length === 0) {
    return (
      <div
        className={`${loadingShell} text-muted-foreground text-sm`}
        data-testid={`chart-error-${symbol}`}
      >
        No data
      </div>
    );
  }

  if (movingAverages2150200 && startHereInterval !== '1d') {
    const maxBars = startHereInterval === '5m' ? 160 : 120;
    const sliced = history.slice(-Math.min(history.length, maxBars));
    const vwapSeries = calculateSessionVwap(sliced);
    const intraChartData = sliced.map((item, index) => {
      const key = sessionDateKeyEt(item.date);
      const prevKey = index > 0 ? sessionDateKeyEt(sliced[index - 1].date) : key;
      const sessionStart = index > 0 && key !== prevKey;
      return {
        ...item,
        color: item.close >= item.open ? '#22c55e' : '#ef4444',
        vwap: vwapSeries[index],
        vwapLine: sessionStart ? null : vwapSeries[index],
      };
    });
    const allPx = intraChartData.flatMap((d) => [d.high, d.low]);
    const vwapVals = vwapSeries.filter((v): v is number => v != null);
    let minP = Math.min(...allPx);
    let maxP = Math.max(...allPx);
    for (const v of vwapVals) {
      minP = Math.min(minP, v);
      maxP = Math.max(maxP, v);
    }
    if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
      minP = 0;
      maxP = 1;
    }
    const pad = (maxP - minP) * 0.05 || 0.01;
    const changePct = sessionChangePct(sliced);

    const outerIv = fillContainer
      ? "flex h-full w-full min-h-0 flex-1 flex-col bg-transparent p-1"
      : "w-full bg-card rounded-lg border border-border p-2";
    const plotIv = fillContainer ? "min-h-0 flex-1" : "h-[160px]";
    const intervalLabel = startHereInterval === '5m' ? '5 min' : '15 min';

    return (
      <div className={outerIv} data-testid={`chart-${symbol}`}>
        <div className={`relative w-full ${plotIv}`}>
          <div
            className="pointer-events-none absolute left-2 top-1 z-10 rounded border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-white/95 shadow-sm backdrop-blur-sm"
            aria-hidden
          >
            <span className="block">{intervalLabel}</span>
            <span className="block font-normal normal-case text-white/80">
              Session VWAP (resets daily · ET)
            </span>
          </div>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minHeight={fillContainer ? 160 : undefined}
            debounce={50}
          >
            <ComposedChart data={intraChartData} margin={{ top: 8, right: 6, left: 4, bottom: 4 }}>
              <XAxis dataKey="date" hide />
              <YAxis domain={[minP - pad, maxP + pad]} hide />
              <Bar
                dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
                shape={MiniChartCandleShape}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="vwapLine"
                stroke="#38bdf8"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className={`text-center ${fillContainer ? 'flex-shrink-0 pt-1' : 'pt-1'}`}>
          <span
            className={`text-sm font-mono font-semibold ${changePct >= 0 ? 'text-rs-green' : 'text-rs-red'}`}
            data-testid={`change-${symbol}`}
          >
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}%
          </span>
        </div>
      </div>
    );
  }

  if (movingAverages2150200 && startHereInterval === '1d') {
    /** Visible daily bars; SMAs still computed on a longer tail so 200d is valid. */
    const maViewDays = 50;
    const maCalcDays = Math.min(
      history.length,
      Math.max(280, maViewDays + 199)
    );
    const calcHistory = history.slice(-maCalcDays);
    const sma21Series = calculateSMA(calcHistory, 21);
    const sma50Series = calculateSMA(calcHistory, 50);
    const sma200Series = calculateSMA(calcHistory, 200);
    const fullMaData = calcHistory.map((item, index) => ({
      ...item,
      color: item.close >= item.open ? "#22c55e" : "#ef4444",
      sma21d: sma21Series[index],
      sma50d: sma50Series[index],
      sma200d: sma200Series[index],
    }));
    const maChartData = fullMaData.slice(-Math.min(maViewDays, fullMaData.length));
    const allPricesMa = maChartData.flatMap((d) => [d.high, d.low]);
    let minPriceMa = Math.min(...allPricesMa);
    let maxPriceMa = Math.max(...allPricesMa);
    if (!Number.isFinite(minPriceMa) || !Number.isFinite(maxPriceMa)) {
      minPriceMa = 0;
      maxPriceMa = 1;
    }
    const priceRangeMa = maxPriceMa - minPriceMa;
    const pricePaddingMa = priceRangeMa * 0.05;
    const lastCandleMa = calcHistory[calcHistory.length - 1];
    const prevCandleMa = calcHistory[calcHistory.length - 2];
    const dailyChangeMa = prevCandleMa
      ? ((lastCandleMa.close - prevCandleMa.close) / prevCandleMa.close) * 100
      : 0;

    const outerMa = fillContainer
      ? "flex h-full w-full min-h-0 flex-1 flex-col bg-transparent p-1"
      : "w-full bg-card rounded-lg border border-border p-2";
    const plotMa = fillContainer ? "min-h-0 flex-1" : "h-[160px]";

    return (
      <div className={outerMa} data-testid={`chart-${symbol}`}>
        <div className={`relative w-full ${plotMa}`}>
          <div
            className="pointer-events-none absolute left-2 top-1 z-10 rounded border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-white/95 shadow-sm backdrop-blur-sm"
            aria-hidden
          >
            <span className="block">Daily</span>
            <span className="block font-normal normal-case text-white/80">
              Last {maViewDays} sessions · 1D interval
            </span>
          </div>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minHeight={fillContainer ? 160 : undefined}
            debounce={50}
          >
            <ComposedChart data={maChartData} margin={{ top: 8, right: 6, left: 4, bottom: 4 }}>
              <XAxis dataKey="date" hide />
              <YAxis domain={[minPriceMa - pricePaddingMa, maxPriceMa + pricePaddingMa]} hide />
              <Bar
                dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
                shape={MiniChartCandleShape}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="sma200d"
                stroke="#ffffff"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="sma50d"
                stroke="#ef4444"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="sma21d"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className={`text-center ${fillContainer ? "flex-shrink-0 pt-1" : "pt-1"}`}>
          <span
            className={`text-sm font-mono font-semibold ${dailyChangeMa >= 0 ? "text-rs-green" : "text-rs-red"}`}
            data-testid={`change-${symbol}`}
          >
            {dailyChangeMa >= 0 ? "+" : ""}
            {dailyChangeMa.toFixed(2)}%
          </span>
        </div>
      </div>
    );
  }

  // Determine indicator type based on signal/pattern
  const is620Cross = technicalSignal === '6_20_cross';
  const isRide21EMA = technicalSignal === 'ride_21_ema';
  const isPullback = technicalSignal?.startsWith('pullback_');
  const isMonthlyTight = chartPattern === 'Monthly Tight';
  const isCupAndHandle = chartPattern === 'Cup and Handle';
  const isPatternWithSMA21 = ['VCP', 'Weekly Tight', 'High Tight Flag'].includes(chartPattern || '');
  
  let displayDays = 90;
  let patternTimeframe = 'all';
  
  if (is620Cross) {
    displayDays = 60;
  } else if (isRide21EMA || isPullback) {
    displayDays = 90;
  } else if (isMonthlyTight) {
    displayDays = 120;
    patternTimeframe = '60D';
  } else if (isCupAndHandle) {
    displayDays = 130; // Show 6 months for cup and handle
    patternTimeframe = 'none'; // No channel overlay
  } else if (timeframe === '20D') {
    displayDays = 60;
    patternTimeframe = '20D';
  } else if (timeframe === '30D') {
    displayDays = 90;
    patternTimeframe = '30D';
  } else if (timeframe === '60D') {
    displayDays = 120;
    patternTimeframe = '60D';
  }

  const slicedHistory = history.slice(-displayDays);
  
  // No channels for Cup and Handle - we draw the cup arc instead
  const channels = (is620Cross || isRide21EMA || isPullback || isCupAndHandle) ? [] : detectConsolidationChannels(slicedHistory, patternTimeframe);
  
  // Cup and Handle: Skip detection and visualization for thumbnails
  // The cup overlay doesn't render properly at small thumbnail size
  // Full visualization is shown on the symbol detail chart instead
  
  // Calculate indicators based on signal type
  // Thumbnail indicators per spreadsheet:
  // - 6/20 Cross: SMA 6 Pink, SMA 20 Blue
  // - Ride 21 EMA: EMA 21 Pink only
  // - Pullback / VCP / Weekly Tight / High Tight Flag / Cup Handle: SMA 21 Pink
  // - Monthly Tight: 3 Month SMA (approx 63 trading days) Pink
  let sma6Values: (number | null)[] = [];
  let sma20Values: (number | null)[] = [];
  let sma21Values: (number | null)[] = [];
  let ema21Values: (number | null)[] = [];
  let sma3MonthValues: (number | null)[] = [];
  
  if (is620Cross) {
    sma6Values = calculateSMA(slicedHistory, 6);
    sma20Values = calculateSMA(slicedHistory, 20);
  } else if (isRide21EMA) {
    // Only show EMA 21 Pink on thumbnail
    ema21Values = calculateEMA(slicedHistory, 21);
  } else if (isMonthlyTight) {
    // 3 Month SMA = approximately 63 trading days
    sma3MonthValues = calculateSMA(slicedHistory, 63);
  } else {
    // Default: SMA 21 for pullbacks, patterns, etc.
    sma21Values = calculateSMA(slicedHistory, 21);
  }

  // Determine cross direction for shading
  const isCrossUp = crossDirection === 'up';
  const shadeFill = isCrossUp ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';

  const chartData = slicedHistory.map((item, index) => {
    const baseData: any = {
      ...item,
      color: item.close >= item.open ? "#22c55e" : "#ef4444",
    };
    
    if (is620Cross) {
      baseData.sma6 = sma6Values[index];
      baseData.sma20 = sma20Values[index];
      // Calculate area between SMAs for shading
      if (sma6Values[index] !== null && sma20Values[index] !== null) {
        baseData.areaTop = Math.max(sma6Values[index]!, sma20Values[index]!);
        baseData.areaBottom = Math.min(sma6Values[index]!, sma20Values[index]!);
      }
    } else if (isRide21EMA) {
      baseData.ema21 = ema21Values[index];
    } else if (isMonthlyTight) {
      baseData.sma3Month = sma3MonthValues[index];
    } else if (isCupAndHandle) {
      // No overlay data for cup and handle thumbnails - just show candlesticks
      // Full visualization is shown on symbol detail chart only
    } else if (isPatternWithSMA21) {
      baseData.sma21 = sma21Values[index];
    }
    
    return baseData;
  });

  const allPrices = slicedHistory.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  const pricePadding = priceRange * 0.05;
  
  const lastCandle = slicedHistory[slicedHistory.length - 1];
  const prevCandle = slicedHistory[slicedHistory.length - 2];
  const dailyChange = prevCandle ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0;

  return (
    <div 
      className="w-full bg-card rounded-lg border border-border p-2"
      data-testid={`chart-${symbol}`}
    >
      <div className="h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <XAxis dataKey="date" hide />
            <YAxis 
              domain={[minPrice - pricePadding, maxPrice + pricePadding]}
              hide
            />
            
            {/* Channel overlays for pattern detection */}
            {channels.map((channel, index) => (
              <ReferenceArea
                key={`channel-${index}`}
                x1={channel.startDate}
                x2={channel.endDate}
                y1={channel.low}
                y2={channel.high}
                fill="#86efac"
                fillOpacity={0.4}
                stroke="#000000"
                strokeWidth={2}
              />
            ))}
            
            {/* 6/20 Cross: Shaded area between SMAs */}
            {is620Cross && (
              <Area
                type="monotone"
                dataKey="areaTop"
                stroke="none"
                fill={shadeFill}
                baseLine={chartData.map(d => d.areaBottom)}
                isAnimationActive={false}
              />
            )}
            
            {/* Candlestick bars (OHLC wicks + open–close body) */}
            <Bar
              dataKey={(item: MiniChartOhlcPayload) => [item.open, item.close]}
              shape={MiniChartCandleShape}
              isAnimationActive={false}
            />
            
            {/* 6/20 Cross indicators */}
            {is620Cross && (
              <>
                <Line
                  type="monotone"
                  dataKey="sma6"
                  stroke="#f472b6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="sma20"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </>
            )}
            
            {/* Ride 21 EMA: Only EMA 21 Pink on thumbnail */}
            {isRide21EMA && (
              <Line
                type="monotone"
                dataKey="ema21"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            
            {/* Monthly Tight: 3 Month SMA Pink */}
            {isMonthlyTight && (
              <Line
                type="monotone"
                dataKey="sma3Month"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            
            {/* Cup and Handle: No overlay on thumbnails - they don't render properly at small size */}
            {/* The full chart visualization works correctly, thumbnails just show the candlesticks */}
            
            {/* Default: SMA 21 for pullbacks, patterns (VCP, Weekly Tight, High Tight Flag) */}
            {!is620Cross && !isRide21EMA && !isMonthlyTight && !isCupAndHandle && isPatternWithSMA21 && (
              <Line
                type="monotone"
                dataKey="sma21"
                stroke="#f472b6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center pt-1">
        <span 
          className={`text-sm font-mono font-semibold ${dailyChange >= 0 ? 'text-rs-green' : 'text-rs-red'}`}
          data-testid={`change-${symbol}`}
        >
          {dailyChange >= 0 ? '+' : ''}{dailyChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
