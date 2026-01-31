import { useWatchlist, useRemoveFromWatchlist } from "@/hooks/use-watchlist";
import { Link } from "wouter";
import { X, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WatchlistWidget() {
  const { data: watchlist, isLoading } = useWatchlist();
  const { mutate: remove, isPending: isRemoving } = useRemoveFromWatchlist();

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Watchlist
      </h3>
      
      {!watchlist?.length ? (
        <div className="px-4 py-8 text-center border-2 border-dashed border-border rounded-xl">
          <p className="text-sm text-muted-foreground">No symbols watched</p>
        </div>
      ) : (
        <div className="space-y-1">
          {watchlist.map((item) => (
            <div
              key={item.id}
              className="group flex items-center justify-between px-4 py-2 rounded-lg hover-elevate"
            >
              <Link href={`/symbol/${item.symbol}`}>
                <div className="flex items-center gap-3 cursor-pointer flex-1">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold font-mono text-primary">
                    {item.symbol.substring(0, 1)}
                  </div>
                  <div>
                    <span className="font-mono font-bold text-sm block">{item.symbol}</span>
                  </div>
                </div>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
                onClick={() => remove(item.id)}
                disabled={isRemoving}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
