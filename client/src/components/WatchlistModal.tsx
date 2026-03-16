import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { 
  useWatchlists, 
  useWatchlist, 
  useCreateWatchlist, 
  useRenameWatchlist, 
  useDeleteWatchlist, 
  useSetDefaultWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useSelectedWatchlistId,
  type Watchlist,
  type SentinelWatchlistItem,
} from "@/hooks/use-watchlist";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Star,
  Pencil,
  Trash2,
  Plus,
  X,
  Check,
  BarChart3,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  List,
} from "lucide-react";

interface WatchlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TickerQuote {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
}

type SortField = "symbol" | "companyName" | "change" | "changePercent" | "entry" | "entryPct";
type SortDir = "asc" | "desc";

export function WatchlistModal({ open, onOpenChange }: WatchlistModalProps) {
  const [, navigate] = useLocation();
  const { cssVariables } = useSystemSettings();
  const { toast } = useToast();

  // Watchlist state - persisted to localStorage
  const [selectedWatchlistId, setSelectedWatchlistId] = useSelectedWatchlistId("watchlistModalSelectedId");
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  
  // Ticker add state
  const [tickerInput, setTickerInput] = useState("");
  const [isAddingTickers, setIsAddingTickers] = useState(false);
  
  // Sort state
  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Hooks
  const { data: watchlists, isLoading: watchlistsLoading } = useWatchlists();
  const createWatchlist = useCreateWatchlist();
  const renameWatchlist = useRenameWatchlist();
  const deleteWatchlist = useDeleteWatchlist();
  const setDefaultWatchlist = useSetDefaultWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  // Auto-select default watchlist on first load
  const effectiveWatchlistId = useMemo(() => {
    if (selectedWatchlistId !== null) return selectedWatchlistId;
    const defaultWl = watchlists?.find(wl => wl.isDefault);
    return defaultWl?.id ?? watchlists?.[0]?.id ?? null;
  }, [selectedWatchlistId, watchlists]);

  // Fetch items for selected watchlist
  const { data: watchlistItems, isLoading: itemsLoading } = useWatchlist(effectiveWatchlistId ?? undefined);

  // Fetch quotes for all tickers in selected watchlist
  const symbols = watchlistItems?.map(item => item.symbol) || [];
  const { data: quotes, isLoading: quotesLoading } = useQuery<TickerQuote[]>({
    queryKey: ["/api/watchlist/quotes/extended", symbols.join(",")],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      const res = await fetch(`/api/watchlist/quotes?symbols=${symbols.join(",")}&extended=true`, { credentials: "include" });
      if (!res.ok) return symbols.map(s => ({ symbol: s, companyName: "", price: 0, change: 0, changePercent: 0 }));
      return res.json();
    },
    enabled: symbols.length > 0,
    staleTime: 60000,
  });

  // Merge items with quotes
  const tickersWithQuotes = useMemo(() => {
    if (!watchlistItems) return [];
    return watchlistItems.map(item => {
      const quote = quotes?.find(q => q.symbol === item.symbol);
      const price = quote?.price || 0;
      const entry = item.targetEntry || null;
      const entryPct = entry && price > 0 ? ((price - entry) / entry) * 100 : null;
      return {
        id: item.id,
        symbol: item.symbol,
        companyName: quote?.companyName || "",
        price,
        change: quote?.change || 0,
        changePercent: quote?.changePercent || 0,
        entry,
        entryPct,
      };
    });
  }, [watchlistItems, quotes]);

  // Sorted tickers
  const sortedTickers = useMemo(() => {
    const sorted = [...tickersWithQuotes];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "symbol":
          cmp = a.symbol.localeCompare(b.symbol);
          break;
        case "companyName":
          cmp = a.companyName.localeCompare(b.companyName);
          break;
        case "change":
          cmp = a.change - b.change;
          break;
        case "changePercent":
          cmp = a.changePercent - b.changePercent;
          break;
        case "entry":
          cmp = (a.entry || 0) - (b.entry || 0);
          break;
        case "entryPct":
          cmp = (a.entryPct || 0) - (b.entryPct || 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [tickersWithQuotes, sortField, sortDir]);

  const selectedWatchlist = watchlists?.find(wl => wl.id === effectiveWatchlistId);

  // Handlers
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleCreateWatchlist = async () => {
    if (!newWatchlistName.trim()) return;
    try {
      const created = await createWatchlist.mutateAsync(newWatchlistName.trim());
      setNewWatchlistName("");
      setIsCreatingNew(false);
      setSelectedWatchlistId(created.id);
    } catch {}
  };

  const handleRename = async (id: number) => {
    if (!editingName.trim()) {
      setEditingWatchlistId(null);
      return;
    }
    try {
      await renameWatchlist.mutateAsync({ id, name: editingName.trim() });
      setEditingWatchlistId(null);
    } catch {}
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteWatchlist.mutateAsync(id);
      if (selectedWatchlistId === id) {
        setSelectedWatchlistId(null);
      }
    } catch {}
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefaultWatchlist.mutateAsync(id);
    } catch {}
  };

  const handleAddTickers = async () => {
    if (!tickerInput.trim() || !effectiveWatchlistId) return;
    setIsAddingTickers(true);
    
    const tickers = tickerInput
      .toUpperCase()
      .split(/[\s,]+/)
      .map(t => t.replace(/^\$/, "").trim())
      .filter(t => t.length > 0 && /^[A-Z]{1,5}$/.test(t));

    if (tickers.length === 0) {
      toast({ title: "Invalid tickers", description: "Enter valid ticker symbols (1-5 letters)", variant: "destructive" });
      setIsAddingTickers(false);
      return;
    }

    let added = 0;
    for (const ticker of tickers) {
      try {
        await addToWatchlist.mutateAsync({ symbol: ticker, watchlistId: effectiveWatchlistId });
        added++;
      } catch {
        // Skip invalid/duplicate tickers
      }
    }

    if (added > 0) {
      toast({ title: `Added ${added} ticker${added > 1 ? "s" : ""}` });
    } else if (tickers.length > 0) {
      toast({ title: "Could not add", description: "Tickers may already be in the list or a server error occurred.", variant: "destructive" });
    }
    setTickerInput("");
    setIsAddingTickers(false);
  };

  const handleRemoveTicker = async (id: number) => {
    try {
      await removeFromWatchlist.mutateAsync({ id });
    } catch {}
  };

  const handleLoadInCharts = () => {
    if (!effectiveWatchlistId || sortedTickers.length === 0) return;
    const firstSymbol = sortedTickers[0].symbol;
    onOpenChange(false);
    navigate(`/sentinel/charts?source=watchlist&watchlistId=${effectiveWatchlistId}&symbol=${firstSymbol}`);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[64.4rem] h-[92vh] flex flex-col p-0 gap-0">
        <DialogDescription className="sr-only">Watchlist Manager</DialogDescription>
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <List className="w-5 h-5" />
            Watchlist Manager
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Left Pane: Watchlist List */}
          <div className="w-64 border-r flex flex-col bg-muted/30">
            <div className="p-3 border-b flex-shrink-0">
              {isCreatingNew ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={newWatchlistName}
                    onChange={(e) => setNewWatchlistName(e.target.value)}
                    placeholder="Watchlist name"
                    className="h-8 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateWatchlist();
                      if (e.key === "Escape") { setIsCreatingNew(false); setNewWatchlistName(""); }
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleCreateWatchlist} disabled={createWatchlist.isPending}>
                    <Check className="w-4 h-4 text-green-500" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setIsCreatingNew(false); setNewWatchlistName(""); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => setIsCreatingNew(true)}
                >
                  <Plus className="w-4 h-4" />
                  Create New
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {watchlistsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : watchlists?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No watchlists yet
                </div>
              ) : (
                watchlists?.map(wl => (
                  <div
                    key={wl.id}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      effectiveWatchlistId === wl.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedWatchlistId(wl.id)}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleSetDefault(wl.id); }}
                      title={wl.isDefault ? "Default watchlist" : "Set as default"}
                    >
                      <Star className={`w-3.5 h-3.5 ${wl.isDefault ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`} />
                    </Button>

                    {editingWatchlistId === wl.id ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-6 text-sm flex-1"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(wl.id);
                            if (e.key === "Escape") setEditingWatchlistId(null);
                          }}
                        />
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleRename(wl.id); }}>
                          <Check className="w-3 h-3 text-green-500" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm">
                          {wl.name}
                          <span className="ml-1 text-muted-foreground text-xs">({(wl as any).itemCount ?? 0})</span>
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 flex-shrink-0 opacity-50 hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); setEditingWatchlistId(wl.id); setEditingName(wl.name); }}
                          title="Rename"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        {!wl.isDefault && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 flex-shrink-0 opacity-50 hover:opacity-100 text-destructive"
                            onClick={(e) => { e.stopPropagation(); handleDelete(wl.id); }}
                            title="Delete watchlist"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Pane: Ticker List */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="p-3 border-b flex items-center gap-2 flex-wrap flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleLoadInCharts}
                disabled={!sortedTickers.length}
              >
                <BarChart3 className="w-4 h-4" />
                Load in Charts
              </Button>

              {selectedWatchlist && !selectedWatchlist.isDefault && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive border-destructive/50 hover:bg-destructive/10"
                  onClick={() => handleDelete(selectedWatchlist.id)}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Watchlist
                </Button>
              )}

              <div className="flex-1" />

              <div className="flex items-center gap-1">
                <Input
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                  placeholder="Add tickers (e.g. AAPL, MSFT)"
                  className="h-8 w-48 text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddTickers(); }}
                />
                <Button
                  size="sm"
                  onClick={handleAddTickers}
                  disabled={isAddingTickers || !tickerInput.trim()}
                >
                  {isAddingTickers ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </Button>
              </div>
            </div>

            {/* Ticker Table */}
            <div className="flex-1 overflow-y-auto">
              {itemsLoading || quotesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : sortedTickers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <List className="w-12 h-12 mb-4 opacity-30" />
                  <p className="text-lg font-medium">No tickers in this watchlist</p>
                  <p className="text-sm">Add tickers using the input above</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-background border-b">
                    <tr>
                      <th
                        className="text-left px-4 py-2 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("symbol")}
                      >
                        <div className="flex items-center gap-1 text-sm font-medium">
                          Ticker <SortIcon field="symbol" />
                        </div>
                      </th>
                      <th
                        className="text-left px-4 py-2 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("companyName")}
                      >
                        <div className="flex items-center gap-1 text-sm font-medium">
                          Company <SortIcon field="companyName" />
                        </div>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("change")}
                      >
                        <div className="flex items-center justify-end gap-1 text-sm font-medium">
                          $ Change <SortIcon field="change" />
                        </div>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("changePercent")}
                      >
                        <div className="flex items-center justify-end gap-1 text-sm font-medium">
                          % Change <SortIcon field="changePercent" />
                        </div>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("entry")}
                      >
                        <div className="flex items-center justify-end gap-1 text-sm font-medium">
                          Entry <SortIcon field="entry" />
                        </div>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer hover:bg-muted/50 select-none"
                        onClick={() => handleSort("entryPct")}
                      >
                        <div className="flex items-center justify-end gap-1 text-sm font-medium">
                          % from Entry <SortIcon field="entryPct" />
                        </div>
                      </th>
                      <th className="w-12 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTickers.map(ticker => (
                      <tr
                        key={ticker.id}
                        className="border-b hover:bg-muted/30 cursor-pointer"
                        onClick={() => { onOpenChange(false); navigate(`/sentinel/charts?source=watchlist&watchlistId=${effectiveWatchlistId}&symbol=${ticker.symbol}`); }}
                      >
                        <td className="px-4 py-2">
                          <span className="font-mono font-bold" style={{ color: cssVariables.textColorHeader }}>
                            {ticker.symbol}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground truncate max-w-[200px]">
                          {ticker.companyName || "—"}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-sm ${ticker.change >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {ticker.change >= 0 ? "+" : ""}{ticker.change.toFixed(2)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-sm ${ticker.changePercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {ticker.changePercent >= 0 ? "+" : ""}{ticker.changePercent.toFixed(2)}%
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm">
                          {ticker.entry ? `$${ticker.entry.toFixed(2)}` : "—"}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-sm ${
                          ticker.entryPct === null ? "text-muted-foreground" :
                          ticker.entryPct >= 0 ? "text-green-500" : "text-red-500"
                        }`}>
                          {ticker.entryPct !== null ? `${ticker.entryPct >= 0 ? "+" : ""}${ticker.entryPct.toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveTicker(ticker.id)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WatchlistModal;
