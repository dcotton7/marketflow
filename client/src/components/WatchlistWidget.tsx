import { 
  useWatchlist, 
  useRemoveFromWatchlist,
  useWatchlists,
  useCreateWatchlist,
  useRenameWatchlist,
  useDeleteWatchlist,
  useSetDefaultWatchlist,
  useSelectedWatchlistId,
  type Watchlist,
} from "@/hooks/use-watchlist";
import { Link, useLocation } from "wouter";
import { 
  X, TrendingUp, TrendingDown, Loader2, ChevronDown, ChevronUp, 
  MessageSquare, BarChart3, Settings, Plus, Star, Pencil, Trash2, Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface WatchlistQuote {
  symbol: string;
  changePercent: number;
}

export function WatchlistWidget() {
  const [, setLocation] = useLocation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showManage, setShowManage] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  
  const { data: watchlists, isLoading: listsLoading } = useWatchlists();
  const [selectedWatchlistId, setSelectedWatchlistId] = useSelectedWatchlistId("sidebarWatchlistId");
  
  const selectedWatchlist = watchlists?.find(wl => wl.id === selectedWatchlistId) 
    || watchlists?.find(wl => wl.isDefault)
    || watchlists?.[0];
  
  const { data: watchlistItems, isLoading: itemsLoading } = useWatchlist(selectedWatchlist?.id);
  const { mutate: remove, isPending: isRemoving } = useRemoveFromWatchlist();
  const createWatchlist = useCreateWatchlist();
  const renameWatchlist = useRenameWatchlist();
  const deleteWatchlist = useDeleteWatchlist();
  const setDefaultWatchlist = useSetDefaultWatchlist();

  const symbols = watchlistItems?.map(item => item.symbol) || [];
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

  const handleSelectWatchlist = (value: string) => {
    setSelectedWatchlistId(parseInt(value));
  };

  const handleCreateWatchlist = async () => {
    if (!newWatchlistName.trim()) return;
    try {
      const created = await createWatchlist.mutateAsync(newWatchlistName.trim());
      setNewWatchlistName("");
      setSelectedWatchlistId(created.id);
    } catch (e) {}
  };

  const handleStartEdit = (wl: Watchlist) => {
    setEditingId(wl.id);
    setEditingName(wl.name);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    try {
      await renameWatchlist.mutateAsync({ id: editingId, name: editingName.trim() });
      setEditingId(null);
      setEditingName("");
    } catch (e) {}
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteWatchlist.mutateAsync(id);
      if (selectedWatchlistId === id) {
        const defaultWl = watchlists?.find(wl => wl.isDefault);
        if (defaultWl) setSelectedWatchlistId(defaultWl.id);
      }
    } catch (e) {}
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefaultWatchlist.mutateAsync(id);
    } catch (e) {}
  };

  if (listsLoading || itemsLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-4">
        <Button
          variant="ghost"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 px-0 flex items-center justify-between h-8"
          data-testid="button-watchlist-toggle"
        >
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Watchlist {watchlistItems?.length ? `(${watchlistItems.length})` : ''}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowManage(!showManage)}
            >
              <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Manage Watchlists</TooltipContent>
        </Tooltip>
      </div>
      
      {isExpanded && (
        <>
          {watchlists && watchlists.length > 0 && (
            <div className="px-4 pb-2">
              <Select 
                value={selectedWatchlist?.id?.toString() || ""} 
                onValueChange={handleSelectWatchlist}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select watchlist" />
                </SelectTrigger>
                <SelectContent>
                  {watchlists.map(wl => (
                    <SelectItem key={wl.id} value={wl.id.toString()}>
                      <div className="flex items-center gap-2">
                        {wl.isDefault && <Star className="w-3 h-3 fill-current text-yellow-500" />}
                        <span>{wl.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showManage && (
            <div className="px-4 pb-3 space-y-3 border-b border-border">
              <div className="flex gap-2">
                <Input
                  placeholder="New watchlist name..."
                  value={newWatchlistName}
                  onChange={(e) => setNewWatchlistName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateWatchlist(); }}
                  className="h-8 text-sm flex-1"
                />
                <Button 
                  size="sm" 
                  className="h-8 px-3"
                  onClick={handleCreateWatchlist}
                  disabled={!newWatchlistName.trim() || createWatchlist.isPending}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {watchlists?.map(wl => (
                  <div key={wl.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50">
                    {editingId === wl.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => { 
                            if (e.key === "Enter") handleSaveEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-7 text-sm flex-1"
                          autoFocus
                        />
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={handleSaveEdit}
                        >
                          <Check className="w-4 h-4 text-green-500" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 flex items-center gap-2 text-sm">
                          {wl.isDefault && (
                            <Star className="w-3 h-3 fill-current text-yellow-500 flex-shrink-0" />
                          )}
                          <span className="truncate">{wl.name}</span>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7"
                              onClick={() => handleSetDefault(wl.id)}
                              disabled={wl.isDefault}
                            >
                              <Star className={`w-3.5 h-3.5 ${wl.isDefault ? "fill-current text-yellow-500" : "text-muted-foreground"}`} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Set as Default</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7"
                              onClick={() => handleStartEdit(wl)}
                            >
                              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Rename</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7 hover:text-red-500"
                              onClick={() => handleDelete(wl.id)}
                              disabled={wl.isDefault || deleteWatchlist.isPending}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {wl.isDefault ? "Cannot delete default" : "Delete (items move to Default)"}
                          </TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!watchlistItems?.length ? (
            <div className="px-4 py-6 text-center border-2 border-dashed border-border rounded-xl mx-4">
              <p className="text-sm text-muted-foreground" data-testid="text-watchlist-empty">
                {watchlists?.length ? "No symbols in this watchlist" : "Create a watchlist to start tracking"}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {watchlistItems.map((item) => {
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
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 px-3 gap-1.5 font-bold shadow-sm border border-rs-amber/20"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/sentinel/evaluate?symbol=${item.symbol}&from=watchlist`); }}
                            data-testid={`button-evaluate-${item.symbol}`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Evaluate</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Ivy AI Evaluation</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 px-3 gap-1.5 font-bold shadow-sm border border-rs-green/20"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/symbol/${item.symbol}`); }}
                            data-testid={`button-chart-${item.symbol}`}
                          >
                            <BarChart3 className="w-3.5 h-3.5" />
                            <span>Chart</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Open Detailed Chart</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground h-7 w-7 hover:text-rs-red hover:bg-rs-red/10"
                            onClick={() => remove({ id: item.id })}
                            disabled={isRemoving}
                            data-testid={`button-remove-${item.symbol}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Remove from Watchlist</TooltipContent>
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
