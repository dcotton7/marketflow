import { useState } from "react";
import { ListPlus, Plus, Check, ChevronDown, CheckCircle } from "lucide-react";
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
  useCreateWatchlist,
  useBulkAddToWatchlist,
  type Watchlist,
} from "@/hooks/use-watchlist";
import { cn } from "@/lib/utils";

interface BulkAddToWatchlistProps {
  symbols: string[];
  className?: string;
  disabled?: boolean;
}

export function BulkAddToWatchlist({ 
  symbols, 
  className,
  disabled = false,
}: BulkAddToWatchlistProps) {
  const { data: watchlists, isLoading: listsLoading } = useWatchlists();
  const createWatchlist = useCreateWatchlist();
  const bulkAdd = useBulkAddToWatchlist();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [addSuccess, setAddSuccess] = useState<{ watchlistName: string; count: number } | null>(null);

  const handleAddToExisting = async (watchlist: Watchlist) => {
    setIsOpen(false);
    bulkAdd.mutate({ symbols, watchlistId: watchlist.id });
  };

  const handleCreateAndAdd = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createWatchlist.mutateAsync(newName.trim());
      const watchlistName = newName.trim();
      setNewName("");
      bulkAdd.mutate(
        { symbols, watchlistId: created.id },
        {
          onSuccess: (result) => {
            setAddSuccess({ watchlistName, count: result.succeeded });
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

  if (symbols.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className={cn("gap-1.5", className)}
            disabled={disabled || listsLoading || bulkAdd.isPending}
          >
            <ListPlus className="h-4 w-4" />
            <span>Add All ({symbols.length})</span>
            <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Add {symbols.length} symbols to watchlist
          </div>
          <DropdownMenuSeparator />
          
          {watchlists?.map((wl) => (
            <DropdownMenuItem
              key={wl.id}
              onClick={() => handleAddToExisting(wl)}
              className="flex items-center justify-between"
            >
              <span className="truncate">{wl.name}</span>
              {wl.isDefault && (
                <span className="text-xs text-muted-foreground">(default)</span>
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
                  {addSuccess.count} symbols added to "{addSuccess.watchlistName}"
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
                  Create a new watchlist and add all {symbols.length} scan results to it.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Label htmlFor="bulk-watchlist-name" className="text-sm font-medium">
                  Watchlist Name
                </Label>
                <Input
                  id="bulk-watchlist-name"
                  placeholder="e.g., Today's Scan Results"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) handleCreateAndAdd();
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
                  onClick={handleCreateAndAdd}
                  disabled={!newName.trim() || createWatchlist.isPending || bulkAdd.isPending}
                >
                  {createWatchlist.isPending || bulkAdd.isPending ? "Adding..." : `Create & Add ${symbols.length}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
