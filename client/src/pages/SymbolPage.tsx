import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { StockChart } from "@/components/StockChart";
import { useStockQuote } from "@/hooks/use-stocks";
import { useAddToWatchlist } from "@/hooks/use-watchlist";
import { Loader2, TrendingUp, TrendingDown, Star, Activity, DollarSign, BarChart3, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SymbolPage() {
  const { symbol } = useParams();
  const [, setLocation] = useLocation();
  const safeSymbol = symbol || "";
  
  const { data: quote, isLoading } = useStockQuote(safeSymbol);
  const { mutate: addToWatchlist, isPending: isAdding } = useAddToWatchlist();
  
  const handleBackToResults = () => {
    setLocation("/");
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!quote) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold">Symbol not found</h2>
          <p className="text-muted-foreground mt-2">Could not load data for {safeSymbol}</p>
        </div>
      </Layout>
    );
  }

  const isPositive = quote.change >= 0;

  return (
    <Layout>
      {/* Back Button */}
      <div className="mb-4">
        <Button 
          variant="ghost" 
          onClick={handleBackToResults}
          className="gap-2"
          data-testid="button-back-to-results"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Results
        </Button>
      </div>

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-4xl md:text-5xl font-bold font-mono tracking-tighter text-foreground">
              {quote.symbol}
            </h1>
            <span className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide">
              Stock
            </span>
          </div>
          <p className="text-lg text-muted-foreground mt-2">{quote.companyName || "Company Name Unavailable"}</p>
        </div>

        <div className="flex items-end gap-6">
          <div className="text-right">
            <div className="text-3xl md:text-4xl font-mono font-bold">
              ${quote.price.toFixed(2)}
            </div>
            <div className={`flex items-center justify-end gap-1 font-mono font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {quote.change > 0 ? "+" : ""}{quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
            </div>
          </div>
          
          <Button 
            size="lg" 
            className="shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
            onClick={() => addToWatchlist({ symbol: quote.symbol })}
            disabled={isAdding}
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Star className="w-4 h-4 mr-2" />}
            Watch
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Activity className="w-4 h-4" />
            <span className="text-sm font-medium">Volume</span>
          </div>
          <div className="text-xl font-mono font-semibold">{(quote.volume / 1000000).toFixed(2)}M</div>
        </div>
        <div className="bg-card p-4 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <DollarSign className="w-4 h-4" />
            <span className="text-sm font-medium">Open</span>
          </div>
          <div className="text-xl font-mono font-semibold">${quote.price.toFixed(2)}</div>
        </div>
        {/* Placeholders for other stats since API is minimal */}
        <div className="bg-card p-4 rounded-xl border border-border opacity-70">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <BarChart3 className="w-4 h-4" />
            <span className="text-sm font-medium">Market Cap</span>
          </div>
          <div className="text-xl font-mono font-semibold">---</div>
        </div>
        <div className="bg-card p-4 rounded-xl border border-border opacity-70">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Activity className="w-4 h-4" />
            <span className="text-sm font-medium">PE Ratio</span>
          </div>
          <div className="text-xl font-mono font-semibold">---</div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="mt-8">
        <StockChart symbol={safeSymbol} />
      </div>
    </Layout>
  );
}
