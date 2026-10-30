import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminTheme } from "@/context/SystemSettingsContext";
import {
  useNamedWatchlistItems,
  useRemoveFromWatchlist,
  useUpdateWatchlist,
  useWatchlists,
} from "@/hooks/use-watchlist";
import { WatchlistColumnPicker } from "@/components/WatchlistColumnPicker";
import {
  WatchlistConfigurableTable,
  type WatchlistConfigurableSortField,
} from "@/components/WatchlistConfigurableTable";
import { TickerPasteBox } from "@/components/TickerPasteBox";
import { TosScreenReviewDialog } from "@/components/watchlist/TosScreenReviewDialog";
import { useWatchlistColumnProfile } from "@/hooks/use-watchlist-table-columns";
import {
  WATCHLIST_COLUMN_META,
  serializeWatchlistColumnProfile,
  type WatchlistColumnId,
} from "@/lib/watchlist-column-profile";
import {
  compareGaugePct,
  gaugeFieldsFromQuote,
  watchlistQuotesUrl,
  watchlistShowsEntryGauges,
} from "@/lib/watchlist-entry-gauges";
import { sectorSpdrThemeLabel } from "@shared/watchlist-theme";
import { fitColumns, positionPl } from "@/lib/watchlist-position-columns";
import { onHostCommand, postToHost } from "@/lib/embed-host";
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardPaste, Loader2, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

const PICK_KEY = "embed-watchlist-pick";
const COLUMNS_KEY = "embed.watchlist-full.columns.v1";
const REFRESH_MS = 15_000;
const FULL_COLUMNS: WatchlistColumnId[] = [
  "symbol", "company", "changePct", "side", "entry", "entryPct", "stop", "stopPct", "shares", "plToday", "plOpen",
  "entryDate", "actions",
];

type SortField = WatchlistConfigurableSortField;
type SortDir = "asc" | "desc";

interface Quote {
  symbol: string;
  companyName: string;
  themeLabel?: string;
  price: number;
  change: number;
  changePercent: number;
}

function seedColumns() {
  try {
    if (!localStorage.getItem(COLUMNS_KEY)) {
      const cols = FULL_COLUMNS.map((id) => ({ id, width: WATCHLIST_COLUMN_META[id].defaultWidth }));
      localStorage.setItem(COLUMNS_KEY, serializeWatchlistColumnProfile(cols));
    }
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * /embed/watchlist-full — the detailed watchlist for an Anima Lab panel: entry, stop, shares and entry date per row,
 * the column picker, a paste box and From Screen (a thinkorswim/Fidelity positions screenshot, reviewed, then one
 * bulk-add; in a portfolio list with shares and entry, updating tickers already there, and removing the tickers not
 * in the screenshot only when he ticks the box after seeing them listed), the writes
 * the embed sign-in allows. A row click opens that ticker's big chart in Anima. Shares the small panel's list pick.
 * Anima is told which list is open (so "add NVDA" in Quinn's chat means this list) and asks for a reload after her
 * chat changed a list, optionally showing a list she just created.
 */
export default function EmbedWatchlistFullPage() {
  const { cssVariables } = useAdminTheme();
  const queryClient = useQueryClient();
  useState(seedColumns);
  const { data: lists } = useWatchlists();
  const [picked, setPicked] = useState<number | null>(() => Number(localStorage.getItem(PICK_KEY)) || null);
  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);

  const { columns, beginResize, addColumn, removeColumn, moveColumn, availableToAdd, applyColumnPreset } =
    useWatchlistColumnProfile(COLUMNS_KEY, "modal");

  const list = useMemo(() => {
    if (picked != null) {
      const hit = lists?.find((l) => l.id === picked);
      if (hit) return hit;
    }
    return lists?.find((l) => l.isDefault) ?? lists?.[0] ?? null;
  }, [picked, lists]);
  const listId = list?.id ?? null;

  useEffect(() => {
    if (picked != null) localStorage.setItem(PICK_KEY, String(picked));
  }, [picked]);

  useEffect(() => {
    postToHost({ type: "ready", page: "watchlist-full" });
  }, []);

  useEffect(() => {
    if (list) postToHost({ type: "watchlist", id: list.id, name: list.name });
  }, [list?.id, list?.name]);

  useEffect(
    () =>
      onHostCommand((cmd) => {
        if (cmd.type !== "refresh-watchlist") return;
        if (cmd.select) setPicked(cmd.select);
        void queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlists"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      }),
    [queryClient],
  );

  const { data: items, isLoading: itemsLoading } = useNamedWatchlistItems(listId);
  const removeFromWatchlist = useRemoveFromWatchlist();
  const updateWatchlist = useUpdateWatchlist();
  const symbols = useMemo(() => (items ?? []).map((i) => i.symbol.trim().toUpperCase()), [items]);
  const gaugesOn = watchlistShowsEntryGauges(columns);

  const { data: quotes, dataUpdatedAt } = useQuery<Quote[]>({
    queryKey: ["embedWatchlistFullQuotes", symbols.join(","), gaugesOn],
    queryFn: async () => {
      const res = await fetch(watchlistQuotesUrl(symbols, { extended: true, gauges: gaugesOn }), {
        credentials: "include",
      });
      if (!res.ok) return [];
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((r: Record<string, unknown>) => {
        const sym = String(r.symbol ?? "").toUpperCase();
        return {
          symbol: sym,
          companyName: String(r.companyName ?? "").trim(),
          themeLabel: String(r.themeLabel ?? r["theme_label"] ?? "").trim() || sectorSpdrThemeLabel(sym),
          price: Number(r.price ?? r.last ?? 0) || 0,
          change: Number(r.change ?? 0) || 0,
          changePercent: Number(r.changePercent ?? r.change_pct ?? 0) || 0,
          ...gaugeFieldsFromQuote(r),
        };
      });
    },
    enabled: symbols.length > 0,
    refetchInterval: REFRESH_MS,
  });

  const rows = useMemo(() => {
    const at = new Map((quotes ?? []).map((q) => [q.symbol, q]));
    const out = (items ?? []).map((item) => {
      const sym = item.symbol.trim().toUpperCase();
      const q = at.get(sym);
      const price = q?.price || 0;
      const entry = item.targetEntry ?? null;
      const stop = item.stopPlan ?? null;
      return {
        id: item.id,
        symbol: item.symbol,
        companyName: q?.companyName ?? "",
        themeLabel: q?.themeLabel || sectorSpdrThemeLabel(item.symbol),
        price,
        change: q?.change || 0,
        changePercent: q?.changePercent || 0,
        entry,
        entryPct: entry && price > 0 ? ((price - entry) / entry) * 100 : null,
        stop,
        stopPct: stop && price > 0 ? ((price - stop) / stop) * 100 : null,
        shares: item.shares ?? null,
        entryDate: item.entryDate ?? null,
        ...positionPl({ direction: item.direction, shares: item.shares, entry, price, change: q?.change ?? null }),
        ...gaugeFieldsFromQuote(q),
      };
    });
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "symbol":
          cmp = a.symbol.localeCompare(b.symbol);
          break;
        case "companyName":
          cmp = (a.companyName || a.themeLabel || "").localeCompare(b.companyName || b.themeLabel || "");
          break;
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
        case "shares":
          cmp = (a.shares || 0) - (b.shares || 0);
          break;
        case "entryDate":
          cmp = (a.entryDate || "").localeCompare(b.entryDate || "");
          break;
        case "vwapPct":
          cmp = compareGaugePct(a.vwapPct, b.vwapPct);
          break;
        case "ema620":
          cmp = compareGaugePct(a.ema620Pct, b.ema620Pct);
          break;
        case "side":
          cmp = a.side.localeCompare(b.side);
          break;
        case "plToday":
          cmp = (a.plToday ?? -Infinity) - (b.plToday ?? -Infinity);
          break;
        case "plOpen":
          cmp = (a.plOpen ?? -Infinity) - (b.plOpen ?? -Infinity);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [items, quotes, sortField, sortDir]);

  // The panel's width decides which columns show: lower-priority ones step aside as it narrows and come back as it
  // widens (fitColumns), so the table fits instead of running off the right edge.
  const tableBox = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = tableBox.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = useMemo(() => fitColumns(columns, boxWidth), [columns, boxWidth]);
  const beginShownResize = useCallback(
    (i: number, e: PointerEvent<HTMLButtonElement>) => {
      const at = columns.findIndex((c) => c === fit.shown[i]);
      if (at >= 0) beginResize(at, e);
    },
    [columns, fit.shown, beginResize],
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-2.5 w-2.5 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />;
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-2 py-1.5 text-xs">
        <select
          value={listId ?? ""}
          onChange={(e) => setPicked(Number(e.target.value) || null)}
          className="h-7 rounded border border-slate-700 bg-slate-900 px-1.5 text-xs"
          data-testid="embed-watchlist-full-pick"
        >
          {(lists ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
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
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className={cn(
            "flex h-7 items-center gap-1 rounded border px-1.5",
            pasteOpen ? "border-cyan-600 text-cyan-300" : "border-slate-700 text-slate-300",
          )}
          title="Paste a Schwab or thinkorswim table, a CSV export, or a list"
          data-testid="embed-watchlist-full-paste"
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          Paste
        </button>
        <button
          type="button"
          onClick={() => setScreenOpen(true)}
          disabled={listId == null}
          className={cn(
            "flex h-7 items-center gap-1 rounded border px-1.5 disabled:opacity-50",
            screenOpen ? "border-cyan-600 text-cyan-300" : "border-slate-700 text-slate-300",
          )}
          title={
            list?.isPortfolio
              ? "Import a thinkorswim or Fidelity positions screenshot: review, then add or update tickers with shares and avg cost"
              : "Import tickers from a thinkorswim or Fidelity screenshot: review, then add them with avg cost as entry"
          }
          data-testid="embed-watchlist-full-from-screen"
        >
          <ScanSearch className="h-3.5 w-3.5" />
          From Screen
        </button>
        <span className="flex-1" />
        {fit.hidden.length > 0 && (
          <span
            className="whitespace-nowrap text-slate-500"
            title={`Hidden to fit the panel: ${fit.hidden.map((id) => WATCHLIST_COLUMN_META[id].label).join(", ")}. Widen the panel to see them.`}
            data-testid="embed-watchlist-full-hidden"
          >
            +{fit.hidden.length} cols
          </span>
        )}
        <span className="text-slate-500">
          {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
        </span>
      </div>
      {pasteOpen && (
        <div className="shrink-0 border-b border-slate-800 p-2">
          <TickerPasteBox watchlistId={listId} isPortfolio={!!list?.isPortfolio} />
        </div>
      )}
      <div ref={tableBox} className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        {itemsLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : rows.length === 0 ? (
          lists && <div className="p-4 text-center text-xs text-slate-500">This list is empty.</div>
        ) : (
          <WatchlistConfigurableTable
            variant="modal"
            columns={fit.shown}
            beginResize={beginShownResize}
            sortedTickers={rows}
            sortField={sortField}
            onSort={handleSort}
            renderSortIcon={(f) => <SortIcon field={f} />}
            cssVariables={cssVariables}
            updateWatchlist={{ mutate: updateWatchlist.mutate }}
            onRemoveTicker={(id) => removeFromWatchlist.mutate({ id })}
            onRowClick={(symbol) => postToHost({ type: "open-big", symbol })}
            density="compact"
            layout="scroll"
          />
        )}
      </div>
      <TosScreenReviewDialog
        open={screenOpen}
        onOpenChange={setScreenOpen}
        watchlistId={listId}
        watchlistName={list?.name ?? "this watchlist"}
        isPortfolio={!!list?.isPortfolio}
        listSymbols={symbols}
      />
    </div>
  );
}
