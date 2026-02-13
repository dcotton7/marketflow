import { Layout } from "@/components/Layout";
import { useWatchlist, useRemoveFromWatchlist } from "@/hooks/use-watchlist";
import { useStockQuote } from "@/hooks/use-stocks";
import { useLocation } from "wouter";
import { Loader2, TrendingUp, TrendingDown, Trash2, Star, BarChart3, MessageSquare, DollarSign, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MiniChart } from "@/components/MiniChart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSystemSettings } from "@/context/SystemSettingsContext";

function WatchlistItem({ item, onRemove }: { 
  item: { id: number; symbol: string }; 
  onRemove: (id: number) => void;
}) {
  const [, setLocation] = useLocation();
  const { cssVariables } = useSystemSettings();
  const { data: quote, isLoading } = useStockQuote(item.symbol);
  const isPositive = quote ? quote.changePercent >= 0 : true;

  return (
    <Card 
      className="hover-elevate transition-all"
      data-testid={`card-watchlist-${item.symbol}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-bold font-mono" style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }} data-testid={`link-symbol-${item.symbol}`}>
              {item.symbol}
            </span>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : quote && (
              <>
                <span className="font-mono font-bold" style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeHeader }} data-testid={`text-price-${item.symbol}`}>
                  ${quote.price.toFixed(2)}
                </span>
                <span className={`flex items-center gap-1 text-sm font-mono font-medium ${isPositive ? "text-rs-green" : "text-rs-red"}`} data-testid={`text-change-${item.symbol}`}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isPositive ? "+" : ""}{quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  data-testid={`button-remove-${item.symbol}`}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from watchlist</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {quote?.companyName && (
          <span style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }} data-testid={`text-company-${item.symbol}`}>{quote.companyName}</span>
        )}
        {quote && (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}>
              <Activity className="w-3 h-3" />
              <span data-testid={`text-volume-${item.symbol}`}>Vol: {(quote.volume / 1000000).toFixed(1)}M</span>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <MiniChart symbol={item.symbol} timeframe="60D" />
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const priceParam = quote ? `&price=${quote.price.toFixed(2)}` : '';
                  setLocation(`/sentinel/evaluate?symbol=${item.symbol}${priceParam}&from=watchlist`);
                }}
                data-testid={`button-ask-ivy-${item.symbol}`}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                Evaluate
              </Button>
            </TooltipTrigger>
            <TooltipContent>Get an AI trade evaluation with current pricing</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/symbol/${item.symbol}`)}
                data-testid={`button-open-chart-${item.symbol}`}
              >
                <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                Open Chart
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open full chart view with technical tools</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WatchlistPage() {
  const { cssVariables } = useSystemSettings();
  const { data: watchlist, isLoading } = useWatchlist();
  const { mutate: removeFromWatchlist } = useRemoveFromWatchlist();

  if (isLoading) {
    return (
      <div className="sentinel-page" style={{ '--logo-opacity': cssVariables.logoOpacity, '--overlay-bg': cssVariables.overlayBg } as React.CSSProperties}>
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
      </div>
    );
  }

  return (
    <div className="sentinel-page" style={{ '--logo-opacity': cssVariables.logoOpacity, '--overlay-bg': cssVariables.overlayBg } as React.CSSProperties}>
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Star className="w-8 h-8 text-primary" />
            <h1 className="font-bold tracking-tight" style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }} data-testid="text-watchlist-heading">Watchlist</h1>
          </div>
          {watchlist && (
            <span className="bg-muted px-3 py-1 rounded-full font-mono" style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
              {watchlist.length} stocks
            </span>
          )}
        </div>

        {(!watchlist || watchlist.length === 0) ? (
          <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-card/30" data-testid="text-watchlist-empty">
            <Star className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="font-medium" style={{ color: cssVariables.textColorSection, fontSize: cssVariables.fontSizeSection }}>No Stocks in Watchlist</h3>
            <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
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
    </div>
  );
}
