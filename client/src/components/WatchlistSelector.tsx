import { useState } from "react";
import { Star, Plus, ChevronDown, Check, CheckCircle, List, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useNamedWatchlistItems,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useCreateWatchlist,
  useEffectiveWatchlistId,
  type Watchlist,
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
    watchlists,
    isLoading: listsLoading,
    selectedId: effectiveListId,
    selectedWatchlist,
    setSelectedId,
  } = useEffectiveWatchlistId();

  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const createWatchlist = useCreateWatchlist();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const { data: watchlistItems } = useNamedWatchlistItems(effectiveListId);

  const watchlistItem = sym
    ? watchlistItems?.find((item) => item.symbol.trim().toUpperCase() === sym)
    : undefined;
  const isWatchlisted = !!watchlistItem;

  const handleSelect = (watchlist: Watchlist) => {
    setSelectedId(watchlist.id);
    setIsOpen(false);
  };

  const handleToggleWatchlist = () => {
    if (!sym || effectiveListId == null) return;
    if (isWatchlisted && watchlistItem) {
      removeFromWatchlist.mutate({ id: watchlistItem.id });
    } else {
      addToWatchlist.mutate({ symbol: sym, watchlistId: effectiveListId });
    }
  };

  const handleCreateNew = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createWatchlist.mutateAsync(newName.trim());
      const watchlistName = newName.trim();
      setSelectedId(created.id);
      setNewName("");
      if (sym) {
        addToWatchlist.mutate(
          { symbol: sym, watchlistId: created.id },
          {
            onSuccess: () => {
              setAddSuccess(watchlistName);
            },
          }
        );
      } else {
        setAddSuccess(watchlistName);
      }
    } catch {
      // Error handled by hook
    }
  };

  const handleOpenCreateModal = () => {
    setIsOpen(false);
    setAddSuccess(null);
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setNewName("");
    setAddSuccess(null);
  };

  const openManager = () => {
    setIsOpen(false);
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
  const listDropdownClass = cn("gap-1", amberBoxBase, maxLabelWidth);

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
                effectiveListId == null ||
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

      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={listDropdownClass}
            data-testid="button-watchlist-dropdown"
          >
            <List className="h-3.5 w-3.5 shrink-0 text-amber-100" />
            <span className={cn("truncate font-medium !text-amber-50", maxLabelWidth)}>{listLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-amber-100" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {watchlists?.map((wl) => (
            <DropdownMenuItem
              key={wl.id}
              onClick={() => handleSelect(wl)}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{wl.name}</span>
              {wl.id === effectiveListId ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleOpenCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Create New Watchlist
          </DropdownMenuItem>

          <DropdownMenuItem onClick={openManager}>
            <Settings2 className="h-4 w-4 mr-2" />
            Load/Edit List
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showCreateModal} onOpenChange={handleCloseModal}>
        <DialogContent className="sm:max-w-[400px]">
          {addSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  {sym ? "Added to Watchlist" : "Watchlist Created"}
                </DialogTitle>
                <DialogDescription>
                  {sym
                    ? `${sym} added to "${addSuccess}"`
                    : `"${addSuccess}" is now your active watchlist.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4">
                <Button onClick={handleCloseModal}>Close</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create New Watchlist</DialogTitle>
                <DialogDescription>
                  {sym
                    ? `Create a new watchlist and add ${sym} to it.`
                    : "Create a new watchlist and set it as active."}
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Label htmlFor="watchlist-name" className="text-sm font-medium">
                  Watchlist Name
                </Label>
                <Input
                  id="watchlist-name"
                  placeholder="e.g., Breakout Candidates"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) handleCreateNew();
                  }}
                  className="mt-2"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseModal}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateNew}
                  disabled={
                    !newName.trim() ||
                    createWatchlist.isPending ||
                    addToWatchlist.isPending
                  }
                >
                  {createWatchlist.isPending || addToWatchlist.isPending
                    ? "Saving..."
                    : sym
                      ? "Create & Add"
                      : "Create"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
