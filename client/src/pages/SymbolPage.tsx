import { useParams, useLocation, useSearch } from "wouter";
import { useState } from "react";
import { Layout } from "@/components/Layout";
import { StockChart } from "@/components/StockChart";
import { useStockQuote } from "@/hooks/use-stocks";
import { useAddToWatchlist } from "@/hooks/use-watchlist";
import { Loader2, TrendingUp, TrendingDown, Star, Activity, DollarSign, BarChart3, ArrowLeft, Building2, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SymbolPage() {
  const { symbol } = useParams();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const selectedPattern = urlParams.get('pattern') || undefined;
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
        <div className="bg-card p-4 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <BarChart3 className="w-4 h-4" />
            <span className="text-sm font-medium">Market Cap</span>
          </div>
          <div className="text-xl font-mono font-semibold">
            {quote.marketCap ? formatMarketCap(quote.marketCap) : '---'}
          </div>
        </div>
        <div className="bg-card p-4 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <PieChart className="w-4 h-4" />
            <span className="text-sm font-medium">PE Ratio</span>
          </div>
          <div className="text-xl font-mono font-semibold">
            {quote.peRatio ? quote.peRatio.toFixed(2) : '---'}
          </div>
        </div>
        <div className="bg-card p-4 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm font-medium">Q Earnings</span>
          </div>
          <div className="text-xl font-mono font-semibold">
            {quote.earnings?.quarterlyGrowthPct !== undefined ? (
              <span className={quote.earnings.quarterlyGrowthPct >= 0 ? "text-green-500" : "text-red-500"}>
                {quote.earnings.quarterlyGrowthPct >= 0 ? '+' : ''}{quote.earnings.quarterlyGrowthPct.toFixed(1)}%
              </span>
            ) : '---'}
          </div>
          {quote.earnings?.surprisePct !== undefined && (
            <div className="text-xs text-muted-foreground mt-1">
              Surprise: {quote.earnings.surprisePct >= 0 ? '+' : ''}{quote.earnings.surprisePct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {/* Chart Section */}
      <div className="mt-8">
        <StockChart symbol={safeSymbol} selectedPattern={selectedPattern} />
      </div>

      {/* Company Description */}
      {quote.description && (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              About {quote.companyName || quote.symbol}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {quote.description.slice(0, 500)}{quote.description.length > 500 ? '...' : ''}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sector Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        {/* Sector & ETFs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Sector Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <span className="text-sm text-muted-foreground">Sector:</span>
              <span className="ml-2 font-medium">{quote.sector || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Industry:</span>
              <span className="ml-2 font-medium">{quote.industry || 'Unknown'}</span>
            </div>
            {quote.sectorETFs && quote.sectorETFs.length > 0 && (
              <div>
                <span className="text-sm text-muted-foreground block mb-2">Sector ETFs:</span>
                <div className="flex gap-2 flex-wrap">
                  {quote.sectorETFs.map((etf) => (
                    <Badge key={etf} variant="secondary" className="font-mono">
                      {etf}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Related Stocks - Top by Market Cap */}
        {quote.relatedStocks && quote.relatedStocks.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Top {quote.sector} Companies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {quote.relatedStocks.map((stock) => (
                  <div 
                    key={stock.symbol} 
                    className="flex items-center justify-between p-3 rounded border border-border hover-elevate cursor-pointer"
                    onClick={() => setLocation(`/symbol/${stock.symbol}`)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-primary min-w-[60px]">{stock.symbol}</span>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{stock.name}</span>
                        <span className="text-xs text-muted-foreground">{stock.description}</span>
                      </div>
                    </div>
                    <span className="text-sm font-mono text-muted-foreground">
                      {stock.marketCap ? formatMarketCap(stock.marketCap) : '---'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
}
