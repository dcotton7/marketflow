import { Layout } from "@/components/Layout";
import { useWatchlist, useRemoveFromWatchlist } from "@/hooks/use-watchlist";
import { useStockQuote } from "@/hooks/use-stocks";
import { useLocation } from "wouter";
import { Loader2, TrendingUp, TrendingDown, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MiniChart } from "@/components/MiniChart";

function WatchlistItem({ item, onRemove }: { 
  item: { id: number; symbol: string }; 
  onRemove: (id: number) => void;
}) {
  const [, setLocation] = useLocation();
  const { data: quote, isLoading } = useStockQuote(item.symbol);
  const isPositive = quote ? quote.changePercent >= 0 : true;

  return (
    <Card 
      className="cursor-pointer hover-elevate transition-all"
      onClick={() => setLocation(`/symbol/${item.symbol}`)}
      data-testid={`card-watchlist-${item.symbol}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-bold font-mono text-xl text-primary">
              {item.symbol}
            </span>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : quote && (
              <>
                <span className="font-mono text-lg">
                  ${quote.price.toFixed(2)}
                </span>
                <span className={`flex items-center gap-1 text-sm font-mono ${isPositive ? "text-green-500" : "text-red-500"}`}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {quote.changePercent.toFixed(2)}%
                </span>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            data-testid={`button-remove-${item.symbol}`}
          >
            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
        {quote?.companyName && (
          <span className="text-sm text-muted-foreground">{quote.companyName}</span>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <MiniChart symbol={item.symbol} timeframe="60D" />
      </CardContent>
    </Card>
  );
}

export default function WatchlistPage() {
  const { data: watchlist, isLoading } = useWatchlist();
  const { mutate: removeFromWatchlist } = useRemoveFromWatchlist();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Star className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
          </div>
          {watchlist && (
            <span className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full font-mono">
              {watchlist.length} stocks
            </span>
          )}
        </div>

        {(!watchlist || watchlist.length === 0) ? (
          <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-card/30">
            <Star className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No Stocks in Watchlist</h3>
            <p className="text-muted-foreground">
              Click the "Watch" button on any stock detail page to add it here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {watchlist.map((item) => (
              <WatchlistItem 
                key={item.id} 
                item={item} 
                onRemove={(id) => removeFromWatchlist(id)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
