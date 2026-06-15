import { Star, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useNamedWatchlistItems,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useEffectiveWatchlistId,
} from "@/hooks/use-watchlist";
import { requestOpenSentinelWatchlistManager } from "@/lib/sentinel-ui-events";
import { cn } from "@/lib/utils";

interface WatchlistSelectorProps {
  /** Ticker to add/remove; omit on header picker (list selection only). */
  symbol?: string;
  className?: string;
  compact?: boolean;
  /** Show star add/remove button (requires symbol). Default true when symbol is set. */
  showAddButton?: boolean;
  /** Opens Watchlist Manager; defaults to global sentinel event. */
  onManageWatchlists?: () => void;
}

export function WatchlistSelector({
  symbol = "",
  className,
  compact = false,
  showAddButton,
  onManageWatchlists,
}: WatchlistSelectorProps) {
  const sym = symbol.trim().toUpperCase();
  const addEnabled = showAddButton ?? Boolean(sym);

  const {
    isLoading: listsLoading,
    selectedWatchlist,
  } = useEffectiveWatchlistId();

  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const { data: watchlistItems } = useNamedWatchlistItems(selectedWatchlist?.id ?? null);

  const watchlistItem = sym
    ? watchlistItems?.find((item) => item.symbol.trim().toUpperCase() === sym)
    : undefined;
  const isWatchlisted = !!watchlistItem;

  const handleToggleWatchlist = () => {
    const listId = selectedWatchlist?.id;
    if (!sym || listId == null) return;
    if (isWatchlisted && watchlistItem) {
      removeFromWatchlist.mutate({ id: watchlistItem.id });
    } else {
      addToWatchlist.mutate({ symbol: sym, watchlistId: listId });
    }
  };

  const openManager = () => {
    if (onManageWatchlists) {
      onManageWatchlists();
    } else {
      requestOpenSentinelWatchlistManager();
    }
  };

  const listLabel = selectedWatchlist?.name ?? "Watchlist";
  const maxLabelWidth = compact ? "max-w-[96px]" : "max-w-[140px]";

  /** Shared amber watchlist chrome (star + list picker). */
  const amberBoxBase = cn(
    "shadow-none transition-colors",
    "!bg-amber-500/30 !border-amber-500/55 !text-amber-50",
    "hover:!bg-amber-500/40 hover:!border-amber-600/65 hover:!text-amber-50"
  );
  const starButtonClass = cn(
    "px-2",
    isWatchlisted
      ? "!border !bg-amber-400 !border-amber-600 !text-zinc-900 shadow-none transition-colors hover:!bg-amber-300 hover:!text-zinc-900"
      : amberBoxBase
  );
  const listButtonClass = cn("gap-1", amberBoxBase, maxLabelWidth);

  if (listsLoading) {
    return (
      <Button variant="outline" size="sm" disabled className={cn("gap-1", amberBoxBase, className)}>
        <List className="h-3.5 w-3.5 text-amber-100" />
        {!compact && <span>Loading...</span>}
      </Button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {addEnabled && sym ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={starButtonClass}
              onClick={handleToggleWatchlist}
              disabled={
                selectedWatchlist?.id == null ||
                addToWatchlist.isPending ||
                removeFromWatchlist.isPending
              }
              data-testid="button-watchlist-add-toggle"
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  isWatchlisted ? "fill-zinc-900 text-zinc-900" : "text-amber-100"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">
              {isWatchlisted
                ? `Remove ${sym} from "${listLabel}"`
                : `Add ${sym} to "${listLabel}"`}
            </p>
          </TooltipContent>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={listButtonClass}
            onClick={openManager}
            data-testid="button-watchlist-dropdown"
            aria-label={`Open Watchlist Manager — ${listLabel}`}
          >
            <List className="h-3.5 w-3.5 shrink-0 text-amber-100" />
            <span className={cn("truncate font-medium !text-amber-50", maxLabelWidth)}>{listLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">Open Watchlist Manager</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
