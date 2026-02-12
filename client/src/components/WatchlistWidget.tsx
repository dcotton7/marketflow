import { useWatchlist, useRemoveFromWatchlist } from "@/hooks/use-watchlist";
import { Link, useLocation } from "wouter";
import { X, TrendingUp, TrendingDown, Loader2, ChevronDown, ChevronUp, MessageSquare, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface WatchlistQuote {
  symbol: string;
  changePercent: number;
}

export function WatchlistWidget() {
  const [, setLocation] = useLocation();
  const { data: watchlist, isLoading } = useWatchlist();
  const { mutate: remove, isPending: isRemoving } = useRemoveFromWatchlist();
  const [isExpanded, setIsExpanded] = useState(true);

  // Fetch quotes for all watchlist symbols with queryFn to pass symbols properly
  const symbols = watchlist?.map(item => item.symbol) || [];
  const { data: quotes } = useQuery<WatchlistQuote[]>({
    queryKey: ['/api/watchlist/quotes', symbols.join(',')],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      const response = await fetch(`/api/watchlist/quotes?symbols=${symbols.join(',')}`);
      if (!response.ok) throw new Error('Failed to fetch quotes');
      return response.json();
    },
    enabled: symbols.length > 0,
    refetchInterval: 60000,
  });

  const getQuote = (symbol: string) => quotes?.find(q => q.symbol === symbol);

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 flex items-center justify-between h-8"
        data-testid="button-watchlist-toggle"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Watchlist {watchlist?.length ? `(${watchlist.length})` : ''}
        </span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </Button>
      
      {isExpanded && (
        <>
          {!watchlist?.length ? (
            <div className="px-4 py-6 text-center border-2 border-dashed border-border rounded-xl">
              <p className="text-sm text-muted-foreground" data-testid="text-watchlist-empty">No symbols watched</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {watchlist.map((item) => {
                const quote = getQuote(item.symbol);
                const changePercent = quote?.changePercent ?? 0;
                const isPositive = changePercent >= 0;
                return (
                  <div
                    key={item.id}
                    className="group flex items-center justify-between px-4 py-1.5 rounded-lg hover-elevate"
                    data-testid={`row-watchlist-${item.symbol}`}
                  >
                    <Link href={`/symbol/${item.symbol}`}>
                      <div className="flex items-center gap-2 cursor-pointer flex-1" data-testid={`link-watchlist-${item.symbol}`}>
                        <span className="font-mono font-bold text-sm" data-testid={`text-symbol-${item.symbol}`}>{item.symbol}</span>
                        {quote !== undefined && (
                          <span 
                            className={`text-xs font-mono flex items-center gap-0.5 ${isPositive ? 'text-rs-green' : 'text-rs-red'}`}
                            data-testid={`text-change-${item.symbol}`}
                          >
                            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/sentinel/evaluate?symbol=${item.symbol}&from=watchlist`); }}
                            data-testid={`button-evaluate-${item.symbol}`}
                          >
                            <MessageSquare className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Evaluate</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/symbol/${item.symbol}`); }}
                            data-testid={`button-chart-${item.symbol}`}
                          >
                            <BarChart3 className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Open Chart</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground h-6 w-6"
                            onClick={() => remove(item.id)}
                            disabled={isRemoving}
                            data-testid={`button-remove-${item.symbol}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
