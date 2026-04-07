import { useState, useEffect, useMemo } from "react";
import { Star, Plus, ChevronDown, Check, CheckCircle } from "lucide-react";
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
  useWatchlists,
  useNamedWatchlistItems,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useCreateWatchlist,
  useSelectedWatchlistId,
  WATCHLIST_MANAGER_STORAGE_KEY,
  type Watchlist,
} from "@/hooks/use-watchlist";
import { cn } from "@/lib/utils";

interface WatchlistSelectorProps {
  symbol: string;
  storageKey?: string;
  className?: string;
  compact?: boolean;
}

export function WatchlistSelector({ 
  symbol, 
  storageKey = WATCHLIST_MANAGER_STORAGE_KEY,
  className,
  compact = false,
}: WatchlistSelectorProps) {
  const { data: watchlists, isLoading: listsLoading } = useWatchlists();
  const [selectedWatchlistId, setSelectedWatchlistId] = useSelectedWatchlistId(storageKey);
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const createWatchlist = useCreateWatchlist();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const effectiveListId = useMemo(() => {
    if (selectedWatchlistId != null && watchlists?.some((w) => w.id === selectedWatchlistId)) {
      return selectedWatchlistId;
    }
    return watchlists?.find((wl) => wl.isDefault)?.id ?? watchlists?.[0]?.id ?? null;
  }, [selectedWatchlistId, watchlists]);

  const { data: watchlistItems } = useNamedWatchlistItems(effectiveListId);

  const selectedWatchlist = watchlists?.find((wl) => wl.id === effectiveListId) ?? null;

  // Auto-select default watchlist if nothing selected
  useEffect(() => {
    if (selectedWatchlistId == null && effectiveListId != null) {
      setSelectedWatchlistId(effectiveListId);
    }
  }, [selectedWatchlistId, effectiveListId, setSelectedWatchlistId]);

  // Check if symbol is already in the selected watchlist
  const watchlistItem = watchlistItems?.find(item => item.symbol === symbol);
  const isWatchlisted = !!watchlistItem;

  const handleSelect = (watchlist: Watchlist) => {
    setSelectedWatchlistId(watchlist.id);
    setIsOpen(false);
  };

  const handleToggleWatchlist = () => {
    if (isWatchlisted && watchlistItem) {
      removeFromWatchlist.mutate({ id: watchlistItem.id });
    } else if (selectedWatchlistId) {
      addToWatchlist.mutate({ symbol, watchlistId: selectedWatchlistId });
    }
  };

  const handleCreateNew = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createWatchlist.mutateAsync(newName.trim());
      const watchlistName = newName.trim();
      setSelectedWatchlistId(created.id);
      setNewName("");
      // Add symbol to the newly created watchlist
      addToWatchlist.mutate(
        { symbol, watchlistId: created.id },
        {
          onSuccess: () => {
            setAddSuccess(watchlistName);
          }
        }
      );
    } catch (e) {
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

  if (listsLoading) {
    return (
      <Button variant="outline" size="sm" disabled className={cn("gap-1", className)}>
        <Star className="h-3.5 w-3.5" />
        {!compact && <span>Loading...</span>}
      </Button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant={isWatchlisted ? "default" : "outline"}
        size="sm"
        className="gap-1 pr-1"
        onClick={handleToggleWatchlist}
        disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
      >
        <Star className={cn("h-3.5 w-3.5", isWatchlisted && "fill-current")} />
        {!compact && (
          <span className="max-w-[80px] truncate">
            {isWatchlisted ? "Watchlisted" : (selectedWatchlist?.name || "Watchlist")}
          </span>
        )}
      </Button>
      
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-1">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {watchlists?.map((wl) => (
            <DropdownMenuItem
              key={wl.id}
              onClick={() => handleSelect(wl)}
              className="flex items-center justify-between"
            >
              <span className="truncate">{wl.name}</span>
              {wl.id === selectedWatchlistId && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={handleOpenCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Create New Watchlist
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
                  Added to Watchlist
                </DialogTitle>
                <DialogDescription>
                  {symbol} added to "{addSuccess}"
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4">
                <Button onClick={handleCloseModal}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create New Watchlist</DialogTitle>
                <DialogDescription>
                  Create a new watchlist and add {symbol} to it.
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
                <Button 
                  variant="outline" 
                  onClick={handleCloseModal}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreateNew}
                  disabled={!newName.trim() || createWatchlist.isPending || addToWatchlist.isPending}
                >
                  {createWatchlist.isPending || addToWatchlist.isPending ? "Adding..." : "Create & Add"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
