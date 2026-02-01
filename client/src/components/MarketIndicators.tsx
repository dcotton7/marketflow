import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MarketQuote {
  symbol: string;
  label: string;
  price: number;
  changePercent: number;
}

const MARKET_SYMBOLS = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "NASDAQ" },
  { symbol: "DIA", label: "Dow" },
  { symbol: "IWM", label: "Russell 2K" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "^VIX", label: "VIX" },
  { symbol: "RSP", label: "S&P EW" },
  { symbol: "QQQE", label: "NDX EW" },
];

export function MarketIndicators() {
  const { data: quotes, isLoading } = useQuery<MarketQuote[]>({
    queryKey: ["/api/market/indicators"],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-bold text-foreground mb-2">Market</p>
        {MARKET_SYMBOLS.map((item) => (
          <div key={item.symbol} className="flex justify-between items-center text-xs py-0.5">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="text-muted-foreground/50">--</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-foreground mb-2">Market</p>
      {quotes?.map((quote) => {
        const isPositive = quote.changePercent >= 0;
        const colorClass = isPositive ? "text-green-500" : "text-red-500";
        return (
          <div 
            key={quote.symbol} 
            className="flex justify-between items-center text-xs py-0.5"
            data-testid={`market-${quote.symbol.replace('^', '')}`}
          >
            <span className="text-muted-foreground">{quote.label}</span>
            <span className={`font-mono flex items-center gap-1 ${colorClass}`}>
              {isPositive ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {isPositive ? "+" : ""}{quote.changePercent.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
