import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CssVariables } from "@/context/SystemSettingsContext";
import {
  useWatchlists,
  useSelectedWatchlistId,
  useNamedWatchlistItems,
  useRemoveFromWatchlist,
  useUpdateWatchlist,
} from "@/hooks/use-watchlist";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, X } from "lucide-react";
import { WatchlistInlinePriceCell } from "@/components/WatchlistInlinePriceCell";
import { StartHereWidgetChrome } from "./StartHereWidgetChrome";
import { useToast } from "@/hooks/use-toast";
import {
  StartHereGroupPicker,
  useStartHere,
  useStartHereGroup,
} from "./StartHereContext";
import {
  START_HERE_MAX_LOAD_CHARTS,
  startHereWatchlistStorageKey,
} from "./dashboard-persistence";

/** Named watchlists only — see docs/start-here-watchlists.md */

interface TickerQuote {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
}

type SortField =
  | "symbol"
  | "companyName"
  | "change"
  | "changePercent"
  | "entry"
  | "entryPct"
  | "stop"
  | "stopPct";
type SortDir = "asc" | "desc";

export function WatchlistPortalWidget({
  cssVariables,
  userId,
  instanceId,
  groupId,
  accentColor,
  onClose,
}: {
  cssVariables: CssVariables;
  userId: number;
  instanceId: string;
  groupId: string;
  accentColor?: string;
  onClose: () => void;
}) {
  const { symbol, setSymbol, accentLabel } = useStartHereGroup(groupId);
  const { dashboard, loadChartsFromList, addChartFromWatchlist, activeStartId } =
    useStartHere();

  /** Authoritative group + palette index for this watchlist tile (props can lag after group picker changes). */
  const getWatchlistSpawnColorOpts = () => {
    const gid = dashboard.instances[instanceId]?.groupId ?? groupId;
    const gstate = gid ? dashboard.groups[gid] : undefined;
    return {
      inheritColorFromGroupId: gid,
      ...(gstate ? { inheritColorIndex: gstate.colorIndex } : {}),
    };
  };
  const { toast } = useToast();
  const watchlistStorageKey = startHereWatchlistStorageKey(
    userId,
    groupId,
    activeStartId
  );
  const { data: watchlists, isLoading: listsLoading } = useWatchlists();
  const [selectedWatchlistId, setSelectedWatchlistId] =
    useSelectedWatchlistId(watchlistStorageKey);
  const removeFromWatchlist = useRemoveFromWatchlist();
  const updateWatchlist = useUpdateWatchlist();

  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const effectiveWatchlistId = useMemo(() => {
    if (selectedWatchlistId !== null && watchlists?.some((w) => w.id === selectedWatchlistId)) {
      return selectedWatchlistId;
    }
    const defaultWl = watchlists?.find((wl) => wl.isDefault);
    return defaultWl?.id ?? watchlists?.[0]?.id ?? null;
  }, [selectedWatchlistId, watchlists]);

  const { data: items, isLoading: itemsLoading } = useNamedWatchlistItems(effectiveWatchlistId);

  const symbols = items?.map((item) => item.symbol) || [];
  const { data: quotes, isLoading: quotesLoading } = useQuery<TickerQuote[]>({
    queryKey: ["/api/watchlist/quotes/extended", symbols.join(",")],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      const res = await fetch(
        `/api/watchlist/quotes?symbols=${symbols.join(",")}&extended=true`,
        { credentials: "include" }
      );
      if (!res.ok) {
        return symbols.map((s) => ({
          symbol: s,
          companyName: "",
          price: 0,
          change: 0,
          changePercent: 0,
        }));
      }
      return res.json();
    },
    enabled: symbols.length > 0,
    staleTime: 60000,
  });

  const tickersWithQuotes = useMemo(() => {
    if (!items) return [];
    return items.map((item) => {
      const quote = quotes?.find((q) => q.symbol === item.symbol);
      const price = quote?.price || 0;
      const entry = item.targetEntry ?? null;
      const stop = item.stopPlan ?? null;
      const entryPct = entry && price > 0 ? ((price - entry) / entry) * 100 : null;
      const stopPct = stop && price > 0 ? ((price - stop) / stop) * 100 : null;
      return {
        id: item.id,
        symbol: item.symbol,
        companyName: quote?.companyName || "",
        price,
        change: quote?.change || 0,
        changePercent: quote?.changePercent || 0,
        entry,
        entryPct,
        stop,
        stopPct,
      };
    });
  }, [items, quotes]);

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

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const handleRemoveTicker = async (id: number) => {
    try {
      await removeFromWatchlist.mutateAsync({ id });
    } catch {
      /* toast optional */
    }
  };

  const handleAddChartToGrid = (sym: string) => {
    const u = sym.trim().toUpperCase();
    if (!u) return;
    addChartFromWatchlist(u, getWatchlistSpawnColorOpts());
    toast({
      title: "Chart added",
      description: `${u} added below your widgets — same group color as this watchlist; size and timeframe match your Default chart.`,
    });
  };

  const handleLoadListIntoCharts = () => {
    const picked = [
      ...new Set(
        sortedTickers
          .map((t) => t.symbol.trim().toUpperCase())
          .filter(Boolean)
      ),
    ].slice(0, START_HERE_MAX_LOAD_CHARTS);
    if (!picked.length) return;
    const { placed, skipped } = loadChartsFromList(picked, getWatchlistSpawnColorOpts());
    const capNote =
      skipped > 0
        ? ` ${skipped} not placed (one viewport of rows below your layout). Scroll down and run again for more.`
        : "";
    toast({
      title: placed > 0 ? "Charts added" : "No charts added",
      description:
        placed > 0
          ? `Placed ${placed} chart(s) in new rows (Default chart size and timeframe). Press Default on a chart widget to change the template.${capNote}`
          : `Nothing fit in the next viewport below your widgets.${capNote}`,
    });
  };

  const headerExtra = (
    <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
  );

  return (
    <StartHereWidgetChrome
      title="Watchlist"
      cssVariables={cssVariables}
      onClose={onClose}
      headerExtra={headerExtra}
      accentColor={accentColor}
      accentLabel={accentLabel}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {listsLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: cssVariables.textColorSmall }} />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Select
              value={effectiveWatchlistId != null ? String(effectiveWatchlistId) : ""}
              onValueChange={(v) => setSelectedWatchlistId(parseInt(v, 10))}
            >
              <SelectTrigger
                className="start-here-no-drag h-9 w-full"
                style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeSmall }}
              >
                <SelectValue placeholder="Select watchlist" />
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="start-here-no-drag w-full text-xs"
              disabled={!sortedTickers.length}
              onClick={handleLoadListIntoCharts}
            >
              Load list into charts
            </Button>
          </div>
        )}

        {itemsLoading || quotesLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: cssVariables.textColorSmall }} />
          </div>
        ) : !items?.length ? (
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
            No symbols in this list.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="sticky top-0 z-[1] border-b bg-background">
                <tr>
                  <th className="start-here-no-drag w-10 px-1 text-center text-xs font-medium text-muted-foreground">
                    Chart
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 select-none hover:bg-muted/50"
                    onClick={() => handleSort("symbol")}
                  >
                    <div className="flex items-center gap-1 text-sm font-medium">
                      Ticker <SortIcon field="symbol" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 select-none hover:bg-muted/50"
                    onClick={() => handleSort("companyName")}
                  >
                    <div className="flex items-center gap-1 text-sm font-medium">
                      Company <SortIcon field="companyName" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 text-right select-none hover:bg-muted/50"
                    onClick={() => handleSort("change")}
                  >
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      $ Change <SortIcon field="change" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 text-right select-none hover:bg-muted/50"
                    onClick={() => handleSort("changePercent")}
                  >
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      % Change <SortIcon field="changePercent" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 text-right select-none hover:bg-muted/50"
                    onClick={() => handleSort("entry")}
                  >
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      Entry <SortIcon field="entry" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 text-right select-none hover:bg-muted/50"
                    onClick={() => handleSort("entryPct")}
                  >
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      % from Entry <SortIcon field="entryPct" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 text-right select-none hover:bg-muted/50"
                    onClick={() => handleSort("stop")}
                  >
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      Stop <SortIcon field="stop" />
                    </div>
                  </th>
                  <th
                    className="start-here-no-drag cursor-pointer px-4 py-2 text-right select-none hover:bg-muted/50"
                    onClick={() => handleSort("stopPct")}
                  >
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      % from Stop <SortIcon field="stopPct" />
                    </div>
                  </th>
                  <th className="w-12 px-2" />
                </tr>
              </thead>
              <tbody>
                {sortedTickers.map((ticker) => {
                  const u = ticker.symbol.toUpperCase();
                  const sel = u === symbol.toUpperCase();
                  return (
                    <tr
                      key={ticker.id}
                      className="cursor-pointer border-b hover:bg-muted/30"
                      style={{
                        backgroundColor: sel ? `${cssVariables.overlayColor}33` : undefined,
                      }}
                      onClick={() => setSymbol(u)}
                    >
                      <td className="px-1 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="start-here-no-drag h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Add chart to grid (same size and timeframe as Default chart)"
                          aria-label={`Add ${ticker.symbol} as chart on the grid`}
                          onClick={() => handleAddChartToGrid(ticker.symbol)}
                        >
                          <BarChart3
                            className="h-4 w-4"
                            style={accentColor ? { color: accentColor } : undefined}
                          />
                        </Button>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className="font-mono font-bold"
                          style={{ color: cssVariables.textColorHeader }}
                        >
                          {ticker.symbol}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2 text-sm text-muted-foreground">
                        {ticker.companyName || "—"}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-sm ${
                          ticker.change >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {ticker.change >= 0 ? "+" : ""}
                        {ticker.change.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-sm ${
                          ticker.changePercent >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {ticker.changePercent >= 0 ? "+" : ""}
                        {ticker.changePercent.toFixed(2)}%
                      </td>
                      <td className="start-here-no-drag px-2 py-2 text-right align-middle">
                        <WatchlistInlinePriceCell
                          value={ticker.entry ?? undefined}
                          onSave={(v) =>
                            updateWatchlist.mutate({ id: ticker.id, data: { targetEntry: v } })
                          }
                          data-testid={`portal-entry-${ticker.id}`}
                        />
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-sm ${
                          ticker.entryPct === null
                            ? "text-muted-foreground"
                            : ticker.entryPct >= 0
                              ? "text-green-500"
                              : "text-red-500"
                        }`}
                      >
                        {ticker.entryPct !== null
                          ? `${ticker.entryPct >= 0 ? "+" : ""}${ticker.entryPct.toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="start-here-no-drag px-2 py-2 text-right align-middle">
                        <WatchlistInlinePriceCell
                          value={ticker.stop ?? undefined}
                          onSave={(v) =>
                            updateWatchlist.mutate({ id: ticker.id, data: { stopPlan: v } })
                          }
                          data-testid={`portal-stop-${ticker.id}`}
                        />
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono text-sm ${
                          ticker.stopPct === null
                            ? "text-muted-foreground"
                            : ticker.stopPct >= 0
                              ? "text-green-500"
                              : "text-red-500"
                        }`}
                      >
                        {ticker.stopPct !== null
                          ? `${ticker.stopPct >= 0 ? "+" : ""}${ticker.stopPct.toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="start-here-no-drag h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveTicker(ticker.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </StartHereWidgetChrome>
  );
}
