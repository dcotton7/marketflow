import { useStockHistory } from "@/hooks/use-stocks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, X, AlertTriangle } from "lucide-react";

interface TradeRiskRatingProps {
  symbol: string;
  currentPrice: number;
}

// Calculate average daily range as percentage (high - low) / close
// This gives the daily trading range relative to the closing price
function calculateAvgRange(data: { high: number; low: number; close: number }[], days: number): number | null {
  if (data.length < days) return null;
  const slice = data.slice(-days);
  const ranges = slice.map(d => ((d.high - d.low) / d.close) * 100);
  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

function calculateSMA(data: { close: number }[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const sum = slice.reduce((acc, d) => acc + d.close, 0);
  return sum / period;
}

// Same VWAP calculation as StockChart - session-based, resets daily
function calculateAutoVWAP(data: { date: string; high: number; low: number; close: number; volume: number }[]): number | null {
  if (data.length === 0) return null;
  
  // Get the last day's data for session VWAP
  const lastDate = new Date(data[data.length - 1].date).toDateString();
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (const d of data) {
    const itemDate = new Date(d.date).toDateString();
    if (itemDate === lastDate) {
      const typicalPrice = (d.high + d.low + d.close) / 3;
      cumulativeTPV += typicalPrice * d.volume;
      cumulativeVolume += d.volume;
    }
  }
  
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null;
}

// Same Anchored VWAP calculation as StockChart - anchored to 6-month low
function calculateAnchoredVWAPFromLow(data: { date: string; high: number; low: number; close: number; volume: number }[]): number | null {
  if (data.length === 0) return null;
  
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
  
  if (anchorIndex === -1) return null;
  
  // Calculate VWAP from anchor point to end
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = anchorIndex; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
  }
  
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null;
}

function isSMAFlatOrRising(data: { close: number }[], period: number): boolean {
  if (data.length < period + 5) return false;
  const current = calculateSMA(data, period);
  const prev = calculateSMA(data.slice(0, -5), period);
  if (current === null || prev === null) return false;
  return current >= prev * 0.995;
}

export function TradeRiskRating({ symbol, currentPrice }: TradeRiskRatingProps) {
  const { data: history, isLoading } = useStockHistory(symbol);
  
  const { data: spyHistory } = useStockHistory('SPY');
  const { data: vixHistory } = useStockHistory('^VIX');

  if (isLoading || !history || history.length < 50) {
    return null;
  }

  const autoVwap = calculateAutoVWAP(history);
  const anchoredVwap = calculateAnchoredVWAPFromLow(history);
  const sma5 = calculateSMA(history, 5);
  const sma20 = calculateSMA(history, 20);
  const sma50 = calculateSMA(history, 50);
  const sma200 = calculateSMA(history, 200);
  
  // Calculate price extension from 50 DSMA
  const priceExtension50 = sma50 !== null ? ((currentPrice - sma50) / sma50) * 100 : null;
  
  // Calculate average trade ranges
  const avgRange5 = calculateAvgRange(history, 5);
  const avgRange20 = calculateAvgRange(history, 20);
  
  // Calculate 20-day ADR (Average Daily Range) in dollar terms
  const adr20Dollar = history.length >= 20 
    ? history.slice(-20).reduce((sum, d) => sum + (d.high - d.low), 0) / 20 
    : null;
  
  // Extension from 50 DSMA in ADR multiples
  const extensionFrom50dAdr = (sma50 !== null && adr20Dollar !== null && adr20Dollar > 0) 
    ? (currentPrice - sma50) / adr20Dollar 
    : null;

  // 10 criteria for 10 bar sections
  const checks = {
    aboveAutoVWAP: autoVwap !== null && currentPrice > autoVwap,
    aboveAnchoredVWAP: anchoredVwap !== null && currentPrice > anchoredVwap,
    sma5Rising: isSMAFlatOrRising(history, 5),
    sma20Rising: isSMAFlatOrRising(history, 20),
    sma50Rising: isSMAFlatOrRising(history, 50),
    sma200Rising: isSMAFlatOrRising(history, 200),
    within4PctOf50: sma50 !== null && currentPrice <= sma50 * 1.04 && currentPrice >= sma50,
    notExtended8xAdr: extensionFrom50dAdr !== null ? extensionFrom50dAdr < 8 : false,
    spy5Rising: spyHistory ? isSMAFlatOrRising(spyHistory, 5) : false,
    vixBelow3: vixHistory && vixHistory.length > 0 ? vixHistory[vixHistory.length - 1].close < 3 : false,
  };
  
  // Check if price is extended 8x ADR or more above 50 DSMA (warning condition)
  const isExtendedWarning = extensionFrom50dAdr !== null && extensionFrom50dAdr >= 8;

  const checkCount = Object.values(checks).filter(Boolean).length;
  const totalChecks = 10;
  
  // Arrow position: 0 checks = far left (0%), 10 checks = far right (100%)
  const arrowPosition = (checkCount / totalChecks) * 100;

  const CheckIcon = ({ passed }: { passed: boolean }) => {
    return passed ? (
      <Check className="w-4 h-4 text-rs-green" />
    ) : (
      <X className="w-4 h-4 text-rs-red" />
    );
  };

  // Gradient segments: RED -> ORANGE -> YELLOW -> YELLOW-GREEN -> LIME -> GREEN
  const gradientColors = [
    '#ef4444', // Red (0-1)
    '#f97316', // Orange (2)
    '#eab308', // Yellow (3-4)
    '#84cc16', // Yellow-Green (5-6)
    '#22c55e', // Lime (7-8)
    '#16a34a', // Green (9)
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 pt-0">
        <CardTitle className="text-lg flex items-center gap-2">
          Trade Risk Assessment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Gradient Bar with Arrow */}
        <div className="pb-3 border-b border-border">
          {/* Arrow indicator */}
          <div className="relative h-4 mb-1">
            <div 
              className="absolute transition-all duration-300"
              style={{ 
                left: `${arrowPosition}%`,
                transform: 'translateX(-50%)'
              }}
            >
              <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-white" />
            </div>
          </div>
          
          {/* Gradient bar - 10 equal sections */}
          <div className="flex h-4 rounded-sm overflow-hidden">
            {Array.from({ length: 10 }).map((_, i) => {
              let colorIndex: number;
              if (i <= 1) colorIndex = 0; // Red
              else if (i === 2) colorIndex = 1; // Orange
              else if (i <= 4) colorIndex = 2; // Yellow
              else if (i <= 6) colorIndex = 3; // Yellow-Green
              else if (i <= 8) colorIndex = 4; // Lime
              else colorIndex = 5; // Green
              
              return (
                <div 
                  key={i} 
                  className="flex-1"
                  style={{ backgroundColor: gradientColors[colorIndex] }}
                />
              );
            })}
          </div>
          
          {/* Score display */}
          <div className="flex justify-between mt-1 text-xs text-muted-foreground">
            <span>High Risk</span>
            <span className="font-medium">{checkCount}/{totalChecks}</span>
            <span>Low Risk</span>
          </div>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.aboveAutoVWAP} />
            <span>Price Above Auto VWAP</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.aboveAnchoredVWAP} />
            <span>Price Above Anchored VWAP (Low)</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.sma5Rising} />
            <span>Flat or rising 5d SMA</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.sma20Rising} />
            <span>Flat or rising 20d SMA</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.sma50Rising} />
            <span>Flat or rising 50d SMA</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.sma200Rising} />
            <span>Flat or rising 200d SMA</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.within4PctOf50} />
            <span>Price Distance above 50-day ≤ 4%</span>
          </div>
          <div className="flex items-center gap-2">
            {isExtendedWarning ? (
              <AlertTriangle className="w-4 h-4 text-rs-yellow" />
            ) : (
              <CheckIcon passed={checks.notExtended8xAdr} />
            )}
            <span className={isExtendedWarning ? "text-rs-yellow" : ""}>
              {isExtendedWarning 
                ? `Extended: ${extensionFrom50dAdr !== null ? extensionFrom50dAdr.toFixed(1) : '?'}x ADR above 50 DSMA (≥8x)`
                : `Price < 8x ADR above 50 DSMA${extensionFrom50dAdr !== null ? ` (${extensionFrom50dAdr.toFixed(1)}x)` : ''}`
              }
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.spy5Rising} />
            <span>S&P 500 5d SMA flat or rising</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.vixBelow3} />
            <span>VIX below 3 for the day</span>
          </div>
        </div>
        
        {/* Additional Metrics below risk box */}
        <div className="pt-3 border-t border-border space-y-3 text-sm">
          {extensionFrom50dAdr !== null && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground leading-tight">
                50d Extension<br />(ADR multiples):
              </span>
              <span className={`font-mono font-medium ${extensionFrom50dAdr >= 8 ? 'text-rs-yellow' : extensionFrom50dAdr >= 0 ? 'text-rs-green' : 'text-rs-red'}`}>
                {extensionFrom50dAdr >= 0 ? '+' : ''}{extensionFrom50dAdr.toFixed(1)}x
              </span>
            </div>
          )}
          {priceExtension50 !== null && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground leading-tight">
                Price Extended<br />from 50 DSMA:
              </span>
              <span className={`font-mono font-medium ${priceExtension50 >= 0 ? 'text-rs-green' : 'text-rs-red'}`}>
                {priceExtension50 >= 0 ? '+' : ''}{priceExtension50.toFixed(1)}%
              </span>
            </div>
          )}
          {avgRange5 !== null && avgRange20 !== null && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground leading-tight">
                Avg Trade Range<br />(5/20 Days):
              </span>
              <span className="font-mono font-medium text-foreground">
                {avgRange5.toFixed(1)}% / {avgRange20.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
