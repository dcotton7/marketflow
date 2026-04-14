import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { AlertBuilderDialog } from "@/components/alerts/AlertBuilderDialog";
import { 
  useWatchlists, 
  useCreateWatchlist, 
  useRenameWatchlist, 
  useDeleteWatchlist, 
  useSetDefaultWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useUpdateWatchlist,
  useSelectedWatchlistId,
  WATCHLIST_MANAGER_STORAGE_KEY,
  useNamedWatchlistItems,
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
import { WatchlistColumnPicker } from "@/components/WatchlistColumnPicker";
import {
  WatchlistConfigurableTable,
  type WatchlistConfigurableSortField,
} from "@/components/WatchlistConfigurableTable";
import { useWatchlistColumnProfile } from "@/hooks/use-watchlist-table-columns";
import { sectorSpdrThemeLabel } from "@shared/watchlist-theme";
import {
  watchlistModalColumnWidthsStorageKey,
  watchlistModalSizeStorageKey,
} from "@/components/start-here/dashboard-persistence";
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
  Bell,
  BriefcaseBusiness,
} from "lucide-react";

interface WatchlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TickerQuote {
  symbol: string;
  companyName: string;
  themeLabel?: string;
  price: number;
  change: number;
  changePercent: number;
}

type SortField = WatchlistConfigurableSortField;
type SortDir = "asc" | "desc";

const MODAL_MIN_W = 760;
const MODAL_MIN_H = 420;
const MODAL_DEFAULT_W = 1030;
const MODAL_MARGIN = 8;

type WatchlistModalLayout = {
  w: number;
  h: number;
  left: number;
  top: number;
};

function clampModalSize(w: number, h: number): { w: number; h: number } {
  if (typeof window === "undefined") {
    return { w, h };
  }
  const maxW = Math.floor(window.innerWidth * 0.96);
  const maxH = Math.floor(window.innerHeight * 0.96);
  return {
    w: Math.min(maxW, Math.max(MODAL_MIN_W, Math.round(w))),
    h: Math.min(maxH, Math.max(MODAL_MIN_H, Math.round(h))),
  };
}

function clampModalPosition(
  left: number,
  top: number,
  w: number,
  h: number
): { left: number; top: number } {
  if (typeof window === "undefined") {
    return { left, top };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxL = Math.max(MODAL_MARGIN, vw - w - MODAL_MARGIN);
  const maxT = Math.max(MODAL_MARGIN, vh - h - MODAL_MARGIN);
  return {
    left: Math.min(maxL, Math.max(MODAL_MARGIN, Math.round(left))),
    top: Math.min(maxT, Math.max(MODAL_MARGIN, Math.round(top))),
  };
}

function defaultModalPosition(w: number, h: number): { left: number; top: number } {
  if (typeof window === "undefined") {
    return { left: MODAL_MARGIN, top: MODAL_MARGIN };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.round((vw - w) / 2);
  const top = Math.round((vh - h) / 2);
  return clampModalPosition(left, top, w, h);
}

function clampModalLayout(layout: WatchlistModalLayout): WatchlistModalLayout {
  const { w, h } = clampModalSize(layout.w, layout.h);
  const { left, top } = clampModalPosition(layout.left, layout.top, w, h);
  return { w, h, left, top };
}

function loadModalLayout(userId: number): WatchlistModalLayout {
  const defH =
    typeof window !== "undefined"
      ? Math.round(window.innerHeight * 0.92)
      : 640;
  const size0 = clampModalSize(MODAL_DEFAULT_W, defH);
  const pos0 = defaultModalPosition(size0.w, size0.h);
  const defaults: WatchlistModalLayout = { ...size0, ...pos0 };

  if (!userId) return clampModalLayout(defaults);

  try {
    const raw = localStorage.getItem(watchlistModalSizeStorageKey(userId));
    if (raw) {
      const j = JSON.parse(raw) as {
        w?: unknown;
        h?: unknown;
        left?: unknown;
        top?: unknown;
      };
      if (typeof j.w === "number" && typeof j.h === "number") {
        const wh = clampModalSize(j.w, j.h);
        if (typeof j.left === "number" && typeof j.top === "number") {
          return clampModalLayout({
            ...wh,
            left: j.left,
            top: j.top,
          });
        }
        return clampModalLayout({ ...wh, ...defaultModalPosition(wh.w, wh.h) });
      }
    }
  } catch {
    /* ignore */
  }
  return clampModalLayout(defaults);
}

function persistModalLayout(userId: number, layout: WatchlistModalLayout) {
  if (!userId) return;
  try {
    const c = clampModalLayout(layout);
    localStorage.setItem(watchlistModalSizeStorageKey(userId), JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function WatchlistModal({ open, onOpenChange }: WatchlistModalProps) {
  const [, navigate] = useLocation();
  const { cssVariables } = useSystemSettings();
  const { user } = useSentinelAuth();
  const { toast } = useToast();

  const uid = user?.id ?? 0;
  const colStorageKey = watchlistModalColumnWidthsStorageKey(uid);
  const { columns, beginResize, addColumn, removeColumn, availableToAdd, applyColumnPreset } =
    useWatchlistColumnProfile(colStorageKey, "modal");

  const contentRef = useRef<HTMLDivElement>(null);
  const resizeDragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const moveDragRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  const [modalLayout, setModalLayout] = useState(() => loadModalLayout(uid));

  useEffect(() => {
    setModalLayout(loadModalLayout(uid));
  }, [uid]);

  useEffect(() => {
    if (!open) return;
    const onWinResize = () => {
      setModalLayout((prev) => {
        const c = clampModalLayout(prev);
        if (c.w !== prev.w || c.h !== prev.h || c.left !== prev.left || c.top !== prev.top) {
          persistModalLayout(uid, c);
        }
        return c;
      });
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [open, uid]);

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    resizeDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = resizeDragRef.current;
    if (!d) return;
    const dw = e.clientX - d.startX;
    const dh = e.clientY - d.startY;
    setModalLayout((prev) =>
      clampModalLayout({
        ...prev,
        w: d.startW + dw,
        h: d.startH + dh,
      })
    );
  }, []);

  const endResizeDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizeDragRef.current) return;
      resizeDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const el = contentRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setModalLayout((prev) => {
          const next = clampModalLayout({
            ...prev,
            w: rect.width,
            h: rect.height,
            left: rect.left,
            top: rect.top,
          });
          persistModalLayout(uid, next);
          return next;
        });
      }
    },
    [uid]
  );

  const onMovePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    moveDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: r.left,
      startTop: r.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onMovePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = moveDragRef.current;
    if (!d) return;
    const dl = e.clientX - d.startX;
    const dt = e.clientY - d.startY;
    setModalLayout((prev) =>
      clampModalLayout({
        ...prev,
        left: d.startLeft + dl,
        top: d.startTop + dt,
      })
    );
  }, []);

  const endMoveDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!moveDragRef.current) return;
      moveDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      setModalLayout((prev) => {
        persistModalLayout(uid, prev);
        return prev;
      });
    },
    [uid]
  );

  // Watchlist state - persisted to localStorage
  const [selectedWatchlistId, setSelectedWatchlistId] = useSelectedWatchlistId(WATCHLIST_MANAGER_STORAGE_KEY);
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  
  // Ticker add state
  const [tickerInput, setTickerInput] = useState("");
  const [isAddingTickers, setIsAddingTickers] = useState(false);
  
  // Sort state
  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Hooks
  const { data: watchlists, isLoading: watchlistsLoading, error: watchlistsError } = useWatchlists();
  const createWatchlist = useCreateWatchlist();
  const renameWatchlist = useRenameWatchlist();
  const deleteWatchlist = useDeleteWatchlist();
  const setDefaultWatchlist = useSetDefaultWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const updateWatchlist = useUpdateWatchlist();

  // Auto-select default watchlist on first load
  const effectiveWatchlistId = useMemo(() => {
    if (selectedWatchlistId !== null) return selectedWatchlistId;
    const defaultWl = watchlists?.find(wl => wl.isDefault);
    return defaultWl?.id ?? watchlists?.[0]?.id ?? null;
  }, [selectedWatchlistId, watchlists]);

  // Fetch items for selected watchlist
  const { data: watchlistItems, isLoading: itemsLoading } = useNamedWatchlistItems(effectiveWatchlistId);

  // Fetch quotes for all tickers in selected watchlist
  const symbols = watchlistItems?.map((item) => item.symbol.trim().toUpperCase()) || [];
  const { data: quotes, isLoading: quotesLoading } = useQuery<TickerQuote[]>({
    queryKey: ["namedWatchlistQuotesExtended", { symbolsKey: symbols.join(","), schema: 3 }],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      const res = await fetch(
        `/api/watchlist/quotes?symbols=${encodeURIComponent(symbols.join(","))}&extended=true`,
        { credentials: "include" }
      );
      if (!res.ok)
        return symbols.map((s) => ({
          symbol: s,
          companyName: "",
          themeLabel: sectorSpdrThemeLabel(s),
          price: 0,
          change: 0,
          changePercent: 0,
        }));
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((row) => {
        const r = row as Record<string, unknown>;
        const themeRaw =
          r.themeLabel ??
          r["theme_label"] ??
          (typeof r.theme === "string" ? r.theme : "");
        const sym = String(r.symbol ?? "");
        return {
          symbol: sym,
          companyName: String(r.companyName ?? "").trim(),
          themeLabel:
            String(themeRaw ?? "").trim() || sectorSpdrThemeLabel(sym),
          price: Number(r.price ?? r.last ?? 0) || 0,
          change: Number(r.change ?? 0) || 0,
          changePercent: Number(r.changePercent ?? r.change_pct ?? 0) || 0,
        };
      });
    },
    enabled: symbols.length > 0,
    staleTime: 60000,
  });

  // Merge items with quotes
  const tickersWithQuotes = useMemo(() => {
    if (!watchlistItems) return [];
    return watchlistItems.map((item) => {
      const symU = item.symbol.trim().toUpperCase();
      const quote = quotes?.find(
        (q) => (q.symbol ?? "").trim().toUpperCase() === symU
      );
      const price = quote?.price || 0;
      const entry = item.targetEntry ?? null;
      const stop = item.stopPlan ?? null;
      const entryPct = entry && price > 0 ? ((price - entry) / entry) * 100 : null;
      const stopPct = stop && price > 0 ? ((price - stop) / stop) * 100 : null;
      return {
        id: item.id,
        symbol: item.symbol,
        companyName: (quote?.companyName ?? "").trim(),
        themeLabel:
          (quote?.themeLabel ?? "").trim() || sectorSpdrThemeLabel(item.symbol),
        price,
        change: quote?.change || 0,
        changePercent: quote?.changePercent || 0,
        entry,
        entryPct,
        stop,
        stopPct,
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
        case "companyName": {
          const an = (a.companyName || a.themeLabel || "").trim();
          const bn = (b.companyName || b.themeLabel || "").trim();
          cmp = an.localeCompare(bn);
          break;
        }
        case "themeLabel": {
          cmp = (a.themeLabel || "").localeCompare(b.themeLabel || "");
          break;
        }
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
        case "stop":
          cmp = (a.stop || 0) - (b.stop || 0);
          break;
        case "stopPct":
          cmp = (a.stopPct || 0) - (b.stopPct || 0);
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

  const handleTogglePortfolio = async (wl: Watchlist) => {
    try {
      await renameWatchlist.mutateAsync({
        id: wl.id,
        isPortfolio: !wl.isPortfolio,
      });
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

  const openChartsWithWatchlistNav = (symbol: string) => {
    if (!effectiveWatchlistId || !sortedTickers.length) return;
    const symOrder = sortedTickers.map((t) => t.symbol).join(",");
    onOpenChange(false);
    navigate(
      `/sentinel/charts?source=watchlist&watchlistId=${effectiveWatchlistId}&symbol=${encodeURIComponent(symbol)}&symOrder=${encodeURIComponent(symOrder)}`
    );
  };

  const handleLoadInCharts = () => {
    openChartsWithWatchlistNav(sortedTickers[0].symbol);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="fixed z-[100] flex max-h-[96vh] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 !max-w-none !translate-x-0 !translate-y-0 !opacity-100 sm:!max-w-none"
        style={{
          width: modalLayout.w,
          height: modalLayout.h,
          left: modalLayout.left,
          top: modalLayout.top,
          transform: "none",
        }}
      >
        <DialogDescription className="sr-only">Watchlist Manager</DialogDescription>
        <DialogHeader
          className="flex-shrink-0 cursor-move touch-none select-none border-b px-4 py-3 pr-12"
          onPointerDown={onMovePointerDown}
          onPointerMove={onMovePointerMove}
          onPointerUp={endMoveDrag}
          onPointerCancel={endMoveDrag}
        >
          <DialogTitle className="flex items-center gap-2 pointer-events-none">
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
              ) : watchlistsError ? (
                <div className="text-center py-8 text-destructive text-sm">
                  Failed to load watchlists
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
                      effectiveWatchlistId === wl.id
                        ? "border border-primary/40 bg-primary/20 text-white"
                        : "text-white/90 hover:bg-muted/70"
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
                        <span className="flex-1 truncate text-sm font-medium text-white">
                          {wl.name}
                          <span className="ml-1 text-white/60 text-xs">({wl.itemCount ?? 0})</span>
                          {wl.isPortfolio ? (
                            <span className="ml-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-500">
                              Portfolio
                            </span>
                          ) : null}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={`h-6 w-6 flex-shrink-0 opacity-70 hover:opacity-100 ${
                            wl.isPortfolio ? "text-emerald-500" : "text-muted-foreground"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleTogglePortfolio(wl);
                          }}
                          title={wl.isPortfolio ? "Portfolio watchlist (on)" : "Mark as portfolio watchlist"}
                        >
                          <BriefcaseBusiness className="w-3.5 h-3.5" />
                        </Button>
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

              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setAlertDialogOpen(true)}
                disabled={!selectedWatchlist || sortedTickers.length === 0}
              >
                <Bell className="w-4 h-4" />
                Alert This Watchlist
              </Button>

              <WatchlistColumnPicker
                columns={columns}
                availableToAdd={availableToAdd}
                addColumn={addColumn}
                removeColumn={removeColumn}
                applyColumnPreset={applyColumnPreset}
              />

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
                <WatchlistConfigurableTable
                  variant="modal"
                  columns={columns}
                  beginResize={beginResize}
                  sortedTickers={sortedTickers}
                  sortField={sortField}
                  onSort={handleSort}
                  renderSortIcon={(f) => <SortIcon field={f} />}
                  cssVariables={cssVariables}
                  updateWatchlist={{ mutate: updateWatchlist.mutate }}
                  onRemoveTicker={handleRemoveTicker}
                  onRowClick={openChartsWithWatchlistNav}
                />
              )}
            </div>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize watchlist dialog"
          className="absolute bottom-0 right-0 z-[60] h-6 w-6 cursor-nwse-resize touch-none rounded-br-lg opacity-50 hover:opacity-100"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        >
          <span
            className="pointer-events-none absolute bottom-1 right-1 block h-3 w-3 border-b-2 border-r-2 border-muted-foreground/80"
            aria-hidden
          />
        </div>
      </DialogContent>

      {selectedWatchlist && (
        <AlertBuilderDialog
          open={alertDialogOpen}
          onOpenChange={setAlertDialogOpen}
          suggestedName={`${selectedWatchlist.name} watchlist alert`}
          tradePlanPreview={{ mode: "per_symbol" }}
          targetScope={{
            mode: "group",
            targetType: "watchlist",
            sourceClient: "watchlist",
            label: selectedWatchlist.name,
            watchlistId: selectedWatchlist.id,
            watchlistName: selectedWatchlist.name,
            symbols: sortedTickers.map((ticker) => ticker.symbol),
            memberCount: sortedTickers.length,
          }}
        />
      )}
    </Dialog>
  );
}

export default WatchlistModal;
