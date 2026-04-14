import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { requestOpenSentinelWatchlistManager } from "@/lib/sentinel-ui-events";
import { WatchlistColumnPicker } from "@/components/WatchlistColumnPicker";
import {
  WatchlistConfigurableTable,
  type WatchlistConfigurableSortField,
} from "@/components/WatchlistConfigurableTable";
import {
  paletteLaneHeaderControlClass,
  StartHereWidgetChrome,
} from "./StartHereWidgetChrome";
import { useToast } from "@/hooks/use-toast";
import {
  StartHereGroupPicker,
  useStartHere,
  useStartHereGroup,
} from "./StartHereContext";
import {
  START_HERE_MAX_LOAD_CHARTS,
  isLinkLaneGroupId,
  startHereWatchlistColumnWidthsStorageKey,
  startHereWatchlistStorageKey,
} from "./dashboard-persistence";
import { useWatchlistColumnProfile } from "@/hooks/use-watchlist-table-columns";
import { sectorSpdrThemeLabel } from "@shared/watchlist-theme";

/** Named watchlists only — see docs/start-here-watchlists.md */

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
  const {
    dashboard,
    loadChartsFromList,
    addChartFromWatchlist,
    activeStartId,
    setDefaultWatchlistTemplate,
    queueWorkspaceRemoteSave,
    setChartTickerOverride,
    broadcastLaneSymbol,
    chartInstanceIdsForGroup,
    workspacePalette,
  } = useStartHere();
  const gid = dashboard.instances[instanceId]?.groupId ?? groupId;
  const laneChartCount = chartInstanceIdsForGroup(gid).length;
  const { accentLabel } = useStartHereGroup(gid);

  /** Authoritative group + palette index for this watchlist tile (props can lag after group picker changes). */
  const getWatchlistSpawnColorOpts = () => {
    const gstate = gid ? dashboard.groups[gid] : undefined;
    if (!gstate) return {};
    if (isLinkLaneGroupId(gid)) {
      return {
        inheritGroupId: gid,
        inheritColorFromGroupId: gid,
        inheritColorIndex: gstate.colorIndex,
      };
    }
    if (
      gstate.accentColorIndex != null &&
      Number.isFinite(gstate.accentColorIndex)
    ) {
      return {
        inheritGroupId: gid,
        inheritColorIndex: gstate.accentColorIndex,
      };
    }
    return { inheritGroupId: gid };
  };
  const { toast } = useToast();
  const watchlistStorageKey = startHereWatchlistStorageKey(
    userId,
    groupId,
    activeStartId
  );

  const defaultWatchlistId = dashboard.defaultWatchlistInstanceId ?? null;
  const columnSeedKey = useMemo(() => {
    if (!defaultWatchlistId || defaultWatchlistId === instanceId) return null;
    return startHereWatchlistColumnWidthsStorageKey(
      userId,
      activeStartId,
      defaultWatchlistId
    );
  }, [defaultWatchlistId, instanceId, userId, activeStartId]);

  const columnStorageKey = startHereWatchlistColumnWidthsStorageKey(
    userId,
    activeStartId,
    instanceId
  );

  const { columns, beginResize, addColumn, removeColumn, availableToAdd, applyColumnPreset } =
    useWatchlistColumnProfile(columnStorageKey, "portal", {
      seedFromStorageKey: columnSeedKey,
    });

  const isDefaultWatchlistTemplate = dashboard.defaultWatchlistInstanceId === instanceId;
  const paletteHdr = paletteLaneHeaderControlClass(accentColor, workspacePalette.unlinkedColor);
  const { data: watchlists, isLoading: listsLoading } = useWatchlists();
  const [selectedWatchlistId, setSelectedWatchlistId] =
    useSelectedWatchlistId(watchlistStorageKey);

  useEffect(() => {
    queueWorkspaceRemoteSave();
  }, [columns, selectedWatchlistId, queueWorkspaceRemoteSave]);
  const removeFromWatchlist = useRemoveFromWatchlist();
  const updateWatchlist = useUpdateWatchlist();

  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [laneBroadcastOpen, setLaneBroadcastOpen] = useState(false);
  const [laneBroadcastSymbol, setLaneBroadcastSymbol] = useState("");

  const watchlistHighlightSymbol = useMemo(() => {
    const gsym = (dashboard.groups[gid]?.symbol ?? "").trim().toUpperCase();
    const fid = dashboard.focusedChartInstanceId;
    const fm = fid ? dashboard.instances[fid] : undefined;
    if (fm?.type === "chart" && fm.groupId === gid) {
      const o = fm.chartSymbolOverride?.trim();
      if (o) return o.toUpperCase();
    }
    return gsym;
  }, [dashboard.focusedChartInstanceId, dashboard.groups, dashboard.instances, gid]);

  const onWatchlistRowSymbol = useCallback(
    (raw: string) => {
      const u = raw.trim().toUpperCase();
      if (!u) return;
      const fid = dashboard.focusedChartInstanceId;
      const fmeta = fid ? dashboard.instances[fid] : undefined;
      const focusedChart = fmeta?.type === "chart" ? fmeta : null;

      // Active chart wins globally: any watchlist row click drives the active chart.
      if (focusedChart && fid) {
        if (focusedChart.linkedSetLocked) {
          broadcastLaneSymbol(focusedChart.groupId, u);
          return;
        }
        setChartTickerOverride(fid, u);
        return;
      }

      if (laneChartCount < 4) {
        broadcastLaneSymbol(gid, u);
      } else {
        setLaneBroadcastSymbol(u);
        setLaneBroadcastOpen(true);
      }
    },
    [
      broadcastLaneSymbol,
      dashboard.focusedChartInstanceId,
      dashboard.instances,
      gid,
      laneChartCount,
      setChartTickerOverride,
    ]
  );

  const effectiveWatchlistId = useMemo(() => {
    if (selectedWatchlistId !== null && watchlists?.some((w) => w.id === selectedWatchlistId)) {
      return selectedWatchlistId;
    }
    const defaultWl = watchlists?.find((wl) => wl.isDefault);
    return defaultWl?.id ?? watchlists?.[0]?.id ?? null;
  }, [selectedWatchlistId, watchlists]);

  const { data: items, isLoading: itemsLoading } = useNamedWatchlistItems(effectiveWatchlistId);

  const symbols = items?.map((item) => item.symbol.trim().toUpperCase()) || [];
  const { data: quotes, isLoading: quotesLoading } = useQuery<TickerQuote[]>({
    // Do not use a queryKey that starts with "/api/..." — default QueryClient queryFn joins keys into a path and would fetch the wrong URL.
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

  const tickersWithQuotes = useMemo(() => {
    if (!items) return [];
    return items.map((item) => {
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
  }, [items, quotes]);

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
    const picked = Array.from(
      new Set(
        sortedTickers
          .map((t) => t.symbol.trim().toUpperCase())
          .filter(Boolean)
      )
    ).slice(0, START_HERE_MAX_LOAD_CHARTS);
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
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          type="button"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "start-here-no-drag h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground",
            paletteHdr
          )}
          aria-label="Open Watchlist Manager"
          onClick={() => requestOpenSentinelWatchlistManager()}
        >
          <Plus className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Open Watchlist Manager</TooltipContent>
      </Tooltip>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          "start-here-no-drag h-8 flex-shrink-0 px-2 text-xs font-medium",
          paletteHdr,
          isDefaultWatchlistTemplate &&
            "bg-muted text-muted-foreground opacity-80 hover:bg-muted/90 hover:opacity-100"
        )}
        title="New watchlist widgets copy visible columns and widths from the tile with Default on. Does not move tiles or resize widgets."
        aria-label={
          isDefaultWatchlistTemplate
            ? "Default column template is on — click to clear"
            : "Use this tile as the column template for new watchlist widgets"
        }
        aria-pressed={isDefaultWatchlistTemplate}
        onClick={() =>
          setDefaultWatchlistTemplate(isDefaultWatchlistTemplate ? null : instanceId)
        }
      >
        Default
      </Button>
      <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
    </div>
  );

  return (
    <>
    <AlertDialog
      open={laneBroadcastOpen}
      onOpenChange={(open) => {
        setLaneBroadcastOpen(open);
        if (!open) setLaneBroadcastSymbol("");
      }}
    >
      <AlertDialogContent className="start-here-no-drag">
        <AlertDialogHeader>
          <AlertDialogTitle>Update all charts on this link lane?</AlertDialogTitle>
          <AlertDialogDescription>
            This lane has {laneChartCount} chart{laneChartCount === 1 ? "" : "s"}. Set every chart to{" "}
            <span className="font-mono font-semibold">{laneBroadcastSymbol}</span> and clear per-chart
            ticker overrides?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            onClick={() => {
              broadcastLaneSymbol(gid, laneBroadcastSymbol);
              setLaneBroadcastOpen(false);
              setLaneBroadcastSymbol("");
            }}
          >
            Update all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <StartHereWidgetChrome
      title="Watchlist"
      cssVariables={cssVariables}
      onClose={onClose}
      headerExtra={headerExtra}
      accentColor={accentColor}
      accentLabel={accentLabel}
      neutralAccentColor={workspacePalette.unlinkedColor}
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
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="start-here-no-drag min-w-0 flex-1 text-xs"
                disabled={!sortedTickers.length}
                onClick={handleLoadListIntoCharts}
              >
                Load list into charts
              </Button>
              <WatchlistColumnPicker
                columns={columns}
                availableToAdd={availableToAdd}
                addColumn={addColumn}
                removeColumn={removeColumn}
                applyColumnPreset={applyColumnPreset}
                triggerClassName="start-here-no-drag flex-shrink-0"
              />
            </div>
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
            <WatchlistConfigurableTable
              variant="portal"
              columns={columns}
              beginResize={beginResize}
              sortedTickers={sortedTickers}
              sortField={sortField}
              onSort={handleSort}
              renderSortIcon={(f) => <SortIcon field={f} />}
              cssVariables={cssVariables}
              updateWatchlist={{ mutate: updateWatchlist.mutate }}
              onRemoveTicker={handleRemoveTicker}
              onRowClick={onWatchlistRowSymbol}
              accentColor={accentColor}
              onAddChartToGrid={handleAddChartToGrid}
              noDragClassName="start-here-no-drag"
              highlightSymbol={watchlistHighlightSymbol}
            />
          </div>
        )}
      </div>
    </StartHereWidgetChrome>
    </>
  );
}
