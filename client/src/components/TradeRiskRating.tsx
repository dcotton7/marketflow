import { useStockHistory } from "@/hooks/use-stocks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, X, Circle } from "lucide-react";

interface TradeRiskRatingProps {
  symbol: string;
  currentPrice: number;
}

function calculateSMA(data: { close: number }[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const sum = slice.reduce((acc, d) => acc + d.close, 0);
  return sum / period;
}

function calculateDailyVWAP(data: { date: string; high: number; low: number; close: number; volume: number }[]): number | null {
  if (data.length === 0) return null;
  
  // Get bars from the most recent trading day
  const lastDate = new Date(data[data.length - 1].date).toDateString();
  const todayBars = data.filter(d => new Date(d.date).toDateString() === lastDate);
  
  // If we only have daily bars, use the last bar
  const barsToUse = todayBars.length > 1 ? todayBars : [data[data.length - 1]];
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const d of barsToUse) {
    const typicalPrice = (d.high + d.low + d.close) / 3;
    cumulativeTPV += typicalPrice * d.volume;
    cumulativeVolume += d.volume;
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

  const vwap = calculateDailyVWAP(history);
  const sma5 = calculateSMA(history, 5);
  const sma20 = calculateSMA(history, 20);
  const sma50 = calculateSMA(history, 50);
  const sma200 = calculateSMA(history, 200);

  const checks = {
    aboveVWAP: vwap !== null && currentPrice > vwap,
    sma5Rising: isSMAFlatOrRising(history, 5),
    sma20Rising: isSMAFlatOrRising(history, 20),
    sma50Rising: isSMAFlatOrRising(history, 50),
    sma200Rising: isSMAFlatOrRising(history, 200),
    within4PctOf50: sma50 !== null && currentPrice <= sma50 * 1.04 && currentPrice >= sma50,
    priceAbove6PctOf50: sma50 !== null && currentPrice > sma50 * 1.06,
    spy5Rising: spyHistory ? isSMAFlatOrRising(spyHistory, 5) : false,
    vixBelow3: vixHistory && vixHistory.length > 0 ? vixHistory[vixHistory.length - 1].close < 3 : false,
  };

  const checkCount = Object.values(checks).filter(Boolean).length;

  let riskLevel: string;
  let riskColor: string;
  let lightColor: string;

  if (checkCount >= 9) {
    riskLevel = "Low Risk Trade";
    riskColor = "text-green-500";
    lightColor = "bg-green-500";
  } else if (checkCount === 8) {
    riskLevel = "Moderate Risk";
    riskColor = "text-lime-400";
    lightColor = "bg-lime-400";
  } else if (checkCount === 7) {
    riskLevel = "Elevated Risk";
    riskColor = "text-yellow-400";
    lightColor = "bg-yellow-400";
  } else if (checkCount === 6) {
    riskLevel = "High Risk";
    riskColor = "text-orange-500";
    lightColor = "bg-orange-500";
  } else {
    riskLevel = "Very High Risk Long Setup";
    riskColor = "text-red-500";
    lightColor = "bg-red-500";
  }

  const CheckIcon = ({ passed, noCheck }: { passed: boolean, noCheck?: boolean }) => {
    if (noCheck) return <Circle className="w-4 h-4 text-muted-foreground opacity-20" />;
    return passed ? (
      <Check className="w-4 h-4 text-green-500" />
    ) : (
      <X className="w-4 h-4 text-red-500" />
    );
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 pt-0">
        <CardTitle className="text-lg flex items-center gap-2">
          Trade Risk Assessment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <div className={`w-4 h-4 rounded-full ${lightColor}`} />
          <span className={`font-bold ${riskColor}`}>{riskLevel}</span>
          <span className="text-sm text-muted-foreground ml-auto">{checkCount}/9</span>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <CheckIcon passed={checks.aboveVWAP} />
            <span>Price Above Daily VWAP</span>
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
            <CheckIcon passed={checks.priceAbove6PctOf50} noCheck />
            <span>Price Distance above 50-day &gt; 6%</span>
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
      </CardContent>
    </Card>
  );
}
