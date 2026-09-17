import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminTheme } from "@/context/SystemSettingsContext";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import {
  useEffectiveWatchlistId,
  useNamedWatchlistItems,
  useRemoveFromWatchlist,
  useUpdateWatchlist,
} from "@/hooks/use-watchlist";
import { WatchlistColumnPicker } from "@/components/WatchlistColumnPicker";
import {
  WatchlistConfigurableTable,
  type WatchlistConfigurableSortField,
} from "@/components/WatchlistConfigurableTable";
import { useWatchlistColumnProfile } from "@/hooks/use-watchlist-table-columns";
import { sectorSpdrThemeLabel } from "@shared/watchlist-theme";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INFOPOP_CHANNEL,
  INFOPOP_STORAGE_KEY,
  type InfoPopMessage,
} from "@/components/infopop/infopop-channel";
import { ArrowDown, ArrowUp, ArrowUpDown, List, Loader2, MonitorDown } from "lucide-react";

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

function infopopColumnStorageKey(userId: number) {
  return `infopop.columns.widget.v1.${userId}`;
}

export default function InfoPopPage() {
  const { cssVariables, pageShellStyle } = useAdminTheme();
  const { user } = useSentinelAuth();
  const uid = user?.id ?? 0;
  const channelRef = useRef<BroadcastChannel | null>(null);

  const {
    watchlists,
    isLoading: listsLoading,
    selectedId: effectiveWatchlistId,
    setSelectedId,
  } = useEffectiveWatchlistId();

  const {
    columns,
    beginResize,
    addColumn,
    removeColumn,
    moveColumn,
    availableToAdd,
    applyColumnPreset,
  } = useWatchlistColumnProfile(infopopColumnStorageKey(uid), "modal", {
    fallback: "simple",
  });

  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data: watchlistItems, isLoading: itemsLoading } =
    useNamedWatchlistItems(effectiveWatchlistId);
  const removeFromWatchlist = useRemoveFromWatchlist();
  const updateWatchlist = useUpdateWatchlist();

  useEffect(() => {
    document.title = "InfoPop";
    const ch = new BroadcastChannel(INFOPOP_CHANNEL);
    channelRef.current = ch;
    ch.postMessage({ type: "INFOPOP_OPENED" } satisfies InfoPopMessage);
    ch.onmessage = (ev: MessageEvent<InfoPopMessage>) => {
      if (ev.data.type === "INFOPOP_DOCK_REQUEST") {
        window.close();
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = Number(params.get("watchlistId"));
    if (Number.isFinite(raw) && raw > 0) {
      setSelectedId(raw);
    }
  }, [setSelectedId]);

  useEffect(() => {
    const handleUnload = () => {
      try {
        localStorage.removeItem(INFOPOP_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      channelRef.current?.postMessage({ type: "INFOPOP_CLOSED" } satisfies InfoPopMessage);
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  const symbols = watchlistItems?.map((item) => item.symbol.trim().toUpperCase()) || [];
  const { data: quotes, isLoading: quotesLoading } = useQuery<TickerQuote[]>({
    queryKey: ["namedWatchlistQuotesExtended", { symbolsKey: symbols.join(","), schema: 3 }],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      const res = await fetch(
        `/api/watchlist/quotes?symbols=${encodeURIComponent(symbols.join(","))}&extended=true`,
        { credentials: "include" }
      );
      if (!res.ok) {
        return symbols.map((s) => ({
          symbol: s,
          companyName: "",
          themeLabel: sectorSpdrThemeLabel(s),
          price: 0,
          change: 0,
          changePercent: 0,
        }));
      }
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((row) => {
        const r = row as Record<string, unknown>;
        const themeRaw =
          r.themeLabel ?? r["theme_label"] ?? (typeof r.theme === "string" ? r.theme : "");
        const sym = String(r.symbol ?? "");
        return {
          symbol: sym,
          companyName: String(r.companyName ?? "").trim(),
          themeLabel: String(themeRaw ?? "").trim() || sectorSpdrThemeLabel(sym),
          price: Number(r.price ?? r.last ?? 0) || 0,
          change: Number(r.change ?? 0) || 0,
          changePercent: Number(r.changePercent ?? r.change_pct ?? 0) || 0,
        };
      });
    },
    enabled: symbols.length > 0,
    staleTime: 60000,
  });

  const tickersWithQuotes = useMemo(() => {
    if (!watchlistItems) return [];
    return watchlistItems.map((item) => {
      const symU = item.symbol.trim().toUpperCase();
      const quote = quotes?.find((q) => (q.symbol ?? "").trim().toUpperCase() === symU);
      const price = quote?.price || 0;
      const entry = item.targetEntry ?? null;
      const stop = item.stopPlan ?? null;
      const entryPct = entry && price > 0 ? ((price - entry) / entry) * 100 : null;
      const stopPct = stop && price > 0 ? ((price - stop) / stop) * 100 : null;
      return {
        id: item.id,
        symbol: item.symbol,
        companyName: (quote?.companyName ?? "").trim(),
        themeLabel: (quote?.themeLabel ?? "").trim() || sectorSpdrThemeLabel(item.symbol),
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
        case "themeLabel":
          cmp = (a.themeLabel || "").localeCompare(b.themeLabel || "");
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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const navigateMain = useCallback((path: string) => {
    channelRef.current?.postMessage({ type: "INFOPOP_NAVIGATE", path } satisfies InfoPopMessage);
  }, []);

  const openChartsWithWatchlistNav = useCallback(
    (symbol: string) => {
      if (!effectiveWatchlistId || !sortedTickers.length) return;
      const symOrder = sortedTickers.map((t) => t.symbol).join(",");
      navigateMain(
        `/sentinel/charts?source=watchlist&watchlistId=${effectiveWatchlistId}&symbol=${encodeURIComponent(symbol)}&symOrder=${encodeURIComponent(symOrder)}`
      );
    },
    [effectiveWatchlistId, sortedTickers, navigateMain]
  );

  const handleDock = useCallback(() => {
    try {
      localStorage.removeItem(INFOPOP_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    channelRef.current?.postMessage({ type: "INFOPOP_CLOSED" } satisfies InfoPopMessage);
    window.close();
  }, []);

  const handleRemoveTicker = async (id: number) => {
    try {
      await removeFromWatchlist.mutateAsync({ id });
    } catch {
      /* toast handled in hook */
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-2.5 h-2.5 opacity-50" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-2.5 h-2.5" />
    ) : (
      <ArrowDown className="w-2.5 h-2.5" />
    );
  };

  const isLoading = listsLoading || itemsLoading || (symbols.length > 0 && quotesLoading);

  return (
    <div
      className="flex h-dvh min-h-0 flex-col"
      style={pageShellStyle as React.CSSProperties}
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1"
        style={{ backgroundColor: cssVariables.headerBg, borderColor: cssVariables.borderOnSecondary }}
      >
        <List className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
        <span
          className="shrink-0 text-xs font-semibold"
          style={{ color: cssVariables.textTitle }}
          title="Pin on top: Win+Ctrl+T (PowerToys)"
        >
          InfoPop
        </span>
        <Select
          value={effectiveWatchlistId != null ? String(effectiveWatchlistId) : ""}
          onValueChange={(v) => {
            const n = Number.parseInt(v, 10);
            setSelectedId(Number.isFinite(n) ? n : null);
          }}
        >
          <SelectTrigger className="h-7 min-w-0 flex-1 text-[11px]">
            <SelectValue placeholder="List" />
          </SelectTrigger>
          <SelectContent>
            {watchlists?.map((wl) => (
              <SelectItem key={wl.id} value={String(wl.id)}>
                {wl.name}
                {wl.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <WatchlistColumnPicker
          columns={columns}
          availableToAdd={availableToAdd}
          addColumn={addColumn}
          removeColumn={removeColumn}
          moveColumn={moveColumn}
          applyColumnPreset={applyColumnPreset}
          iconOnly
          triggerClassName="h-7 w-7"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-slate-400 hover:text-cyan-400"
          onClick={handleDock}
          title="Dock / close InfoPop"
        >
          <MonitorDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sortedTickers.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">No tickers in this list</p>
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
            density="compact"
            layout="scroll"
          />
        )}
      </div>
    </div>
  );
}
