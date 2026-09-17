import type { MouseEvent, PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { WatchlistInlinePriceCell } from "@/components/WatchlistInlinePriceCell";
import { WatchlistResizableTh } from "@/components/WatchlistResizableTh";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CssVariables } from "@/context/SystemSettingsContext";
import type { WatchlistColumnEntry, WatchlistColumnId } from "@/lib/watchlist-column-profile";
import { WATCHLIST_COLUMN_META } from "@/lib/watchlist-column-profile";
import { BarChart3, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ROW_NAME_TIP_DELAY_MS = 280;

/** Company / ETF name + optional Flow theme when both differ (e.g. Alpaca name vs cluster). */
function watchlistRowHoverLabel(ticker: WatchlistConfigurableTickerRow): string {
  const n = ticker.companyName?.trim();
  const t = ticker.themeLabel?.trim();
  if (n && t && n !== t) return `${n}\nTheme: ${t}`;
  if (n) return n;
  if (t) return `Theme: ${t}`;
  const s = ticker.symbol?.trim();
  return s || "—";
}

export type WatchlistConfigurableSortField =
  | "symbol"
  | "companyName"
  | "themeLabel"
  | "change"
  | "changePercent"
  | "entry"
  | "entryPct"
  | "stop"
  | "stopPct";

function sortFieldForColumn(id: WatchlistColumnId): WatchlistConfigurableSortField | null {
  switch (id) {
    case "symbol":
      return "symbol";
    case "company":
      return "companyName";
    case "theme":
      return "themeLabel";
    case "change":
      return "change";
    case "changePct":
      return "changePercent";
    case "entry":
      return "entry";
    case "entryPct":
      return "entryPct";
    case "stop":
      return "stop";
    case "stopPct":
      return "stopPct";
    default:
      return null;
  }
}

export interface WatchlistConfigurableTickerRow {
  id: number;
  symbol: string;
  companyName: string;
  /** Market Flow theme name when symbol maps to a cluster / ETF proxy (extended quotes). */
  themeLabel?: string;
  change: number;
  changePercent: number;
  entry: number | null;
  entryPct: number | null;
  stop: number | null;
  stopPct: number | null;
}

export function WatchlistConfigurableTable({
  variant,
  columns,
  beginResize,
  sortedTickers,
  sortField,
  onSort,
  renderSortIcon,
  cssVariables,
  updateWatchlist,
  onRemoveTicker,
  onRowClick,
  accentColor,
  onAddChartToGrid,
  noDragClassName = "",
  highlightSymbol,
  density = "normal",
  layout = "fill",
}: {
  variant: "modal" | "portal";
  columns: WatchlistColumnEntry[];
  beginResize: (columnIndex: number, e: PointerEvent<HTMLButtonElement>) => void;
  sortedTickers: WatchlistConfigurableTickerRow[];
  sortField: WatchlistConfigurableSortField;
  onSort: (f: WatchlistConfigurableSortField) => void;
  renderSortIcon: (f: WatchlistConfigurableSortField) => React.ReactNode;
  cssVariables: CssVariables;
  updateWatchlist: {
    mutate: (args: {
      id: number;
      data: { targetEntry?: number | null; stopPlan?: number | null };
    }) => void;
  };
  onRemoveTicker: (id: number) => void;
  onRowClick: (symbol: string) => void;
  accentColor?: string;
  onAddChartToGrid?: (symbol: string) => void;
  /** e.g. `start-here-no-drag` for Start Here portal */
  noDragClassName?: string;
  /** Highlight row when symbol matches (Start Here linked symbol). */
  highlightSymbol?: string;
  density?: "normal" | "compact";
  /** fill = stretch to container; scroll = fixed column widths, parent scrolls. */
  layout?: "fill" | "scroll";
}) {
  const nd = (c: string) => cn(c, noDragClassName);
  const compact = density === "compact";
  const pad = compact ? "px-1 py-0.5" : "px-1 py-2";
  const bodyText = compact ? "text-xs" : "text-sm";
  const iconBtn = compact ? "h-6 w-6" : "h-7 w-7";

  const headerInner = (id: WatchlistColumnId) => {
    const label = WATCHLIST_COLUMN_META[id].label;
    const sf = sortFieldForColumn(id);
    if (!sf) {
      return (
        <span className={cn("block min-w-0 truncate font-medium leading-none", compact ? "text-[11px]" : "text-sm")} title={label}>
          {label}
        </span>
      );
    }
    return (
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-1 font-medium",
          compact ? "text-[11px]" : "text-sm",
          id === "symbol" || id === "company" || id === "theme" ? "justify-start" : "justify-end"
        )}
      >
        <span className="min-w-0 truncate leading-none" title={label}>
          {label}
        </span>
        <span className="shrink-0">{renderSortIcon(sf)}</span>
      </div>
    );
  };

  const headerSortHandler = (sf: WatchlistConfigurableSortField | null) =>
    sf
      ? (e: MouseEvent<HTMLTableCellElement>) => {
          if ((e.target as HTMLElement).closest("[data-watchlist-col-resize]")) return;
          onSort(sf);
        }
      : undefined;

  const headerClass = (id: WatchlistColumnId) =>
    nd(
      cn(
        "select-none hover:bg-muted/50",
        id === "chart" ? `${pad} text-center text-xs font-medium text-muted-foreground` : "",
        sortFieldForColumn(id)
          ? `cursor-pointer ${pad}`
          : id === "chart"
            ? ""
            : pad,
        id === "chart"
          ? "text-center"
          : id === "symbol" || id === "company" || id === "theme"
            ? "text-left"
            : "text-right"
      )
    );

  const tipContent = (ticker: WatchlistConfigurableTickerRow) => (
    <TooltipContent
      side="top"
      className="max-w-[min(90vw,28rem)] break-words text-sm"
    >
      {watchlistRowHoverLabel(ticker)}
    </TooltipContent>
  );

  const renderCell = (colId: WatchlistColumnId, ticker: WatchlistConfigurableTickerRow) => {
    switch (colId) {
      case "chart":
        return (
          <td
            key={colId}
            className={nd(`overflow-hidden ${pad} text-center`)}
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={nd(`${iconBtn} text-muted-foreground hover:text-foreground`)}
                  aria-label={`Add ${ticker.symbol} as chart on the grid`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddChartToGrid?.(ticker.symbol);
                  }}
                >
                  <BarChart3
                    className="h-4 w-4"
                    style={accentColor ? { color: accentColor } : undefined}
                  />
                </Button>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "symbol":
        return (
          <td key={colId} className={`overflow-hidden ${pad}`}>
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default truncate">
                  <span
                    className="font-mono font-bold"
                    style={{ color: cssVariables.textColorHeader }}
                  >
                    {ticker.symbol}
                  </span>
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "company": {
        const primary =
          ticker.companyName?.trim() || ticker.themeLabel?.trim() || "";
        const themeSub =
          ticker.companyName?.trim() &&
          ticker.themeLabel?.trim() &&
          ticker.companyName.trim() !== ticker.themeLabel.trim()
            ? ticker.themeLabel.trim()
            : null;
        return (
          <td key={colId} className={`overflow-hidden ${pad} ${bodyText} text-muted-foreground`}>
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default">
                  <span className="block truncate">{primary || "—"}</span>
                  {themeSub ? (
                    <span className="mt-0.5 block truncate text-[10px] text-cyan-400/80">
                      {themeSub}
                    </span>
                  ) : null}
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      }
      case "theme":
        return (
          <td key={colId} className={`overflow-hidden ${pad} ${bodyText} text-muted-foreground`}>
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default truncate">
                  {ticker.themeLabel?.trim() || "—"}
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "change":
        return (
          <td
            key={colId}
            className={cn(
              `overflow-hidden ${pad} text-right font-mono ${bodyText} tabular-nums`,
              ticker.change >= 0 ? "text-green-500" : "text-red-500"
            )}
          >
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default truncate">
                  {ticker.change >= 0 ? "+" : ""}
                  {ticker.change.toFixed(2)}
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "changePct":
        return (
          <td
            key={colId}
            className={cn(
              `overflow-hidden ${pad} text-right font-mono ${bodyText} tabular-nums`,
              ticker.changePercent >= 0 ? "text-green-500" : "text-red-500"
            )}
          >
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default truncate">
                  {ticker.changePercent >= 0 ? "+" : ""}
                  {ticker.changePercent.toFixed(2)}%
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "entry":
        return (
          <td key={colId} className={nd(`overflow-hidden ${pad} text-right align-middle`)}>
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <div className="block min-w-0">
                  <WatchlistInlinePriceCell
                    value={ticker.entry ?? undefined}
                    allowClear
                    onSave={(v) =>
                      updateWatchlist.mutate({ id: ticker.id, data: { targetEntry: v } })
                    }
                    data-testid={`wl-entry-${variant}-${ticker.id}`}
                  />
                </div>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "entryPct":
        return (
          <td
            key={colId}
            className={cn(
              `overflow-hidden ${pad} text-right font-mono ${bodyText} tabular-nums`,
              ticker.entryPct === null
                ? "text-muted-foreground"
                : ticker.entryPct >= 0
                  ? "text-green-500"
                  : "text-red-500"
            )}
          >
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default truncate">
                  {ticker.entryPct !== null
                    ? `${ticker.entryPct >= 0 ? "+" : ""}${ticker.entryPct.toFixed(2)}%`
                    : "—"}
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "stop":
        return (
          <td key={colId} className={nd(`overflow-hidden ${pad} text-right align-middle`)}>
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <div className="block min-w-0">
                  <WatchlistInlinePriceCell
                    value={ticker.stop ?? undefined}
                    allowClear
                    onSave={(v) =>
                      updateWatchlist.mutate({ id: ticker.id, data: { stopPlan: v } })
                    }
                    data-testid={`wl-stop-${variant}-${ticker.id}`}
                  />
                </div>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "stopPct":
        return (
          <td
            key={colId}
            className={cn(
              `overflow-hidden ${pad} text-right font-mono ${bodyText} tabular-nums`,
              ticker.stopPct === null
                ? "text-muted-foreground"
                : ticker.stopPct >= 0
                  ? "text-green-500"
                  : "text-red-500"
            )}
          >
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span className="block min-w-0 cursor-default truncate">
                  {ticker.stopPct !== null
                    ? `${ticker.stopPct >= 0 ? "+" : ""}${ticker.stopPct.toFixed(2)}%`
                    : "—"}
                </span>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      case "actions":
        return (
          <td
            key={colId}
            className={nd(`overflow-hidden ${pad}`)}
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip delayDuration={ROW_NAME_TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className={nd(`${iconBtn} text-muted-foreground hover:text-destructive`)}
                  onClick={() => onRemoveTicker(ticker.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              {tipContent(ticker)}
            </Tooltip>
          </td>
        );
      default:
        return null;
    }
  };

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || 1;
  const scrollLayout = layout === "scroll";

  return (
    <table
      className={cn("table-fixed", scrollLayout ? "min-w-0" : "w-full min-w-0")}
      style={scrollLayout ? { width: totalWidth, minWidth: totalWidth } : undefined}
    >
      <colgroup>
        {columns.map((c, i) => (
          <col
            key={`${c.id}-${i}`}
            style={
              scrollLayout
                ? { width: c.width }
                : { width: `${(c.width / totalWidth) * 100}%` }
            }
          />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-[1] border-b bg-background">
        <tr>
          {columns.map((c, i) => {
            const sf = sortFieldForColumn(c.id);
            const last = i === columns.length - 1;
            return (
              <WatchlistResizableTh
                key={`${c.id}-${i}`}
                columnIndex={i}
                onResizeStart={beginResize}
                showResizeHandle={!last}
                className={headerClass(c.id)}
                onClick={headerSortHandler(sf)}
              >
                {headerInner(c.id)}
              </WatchlistResizableTh>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedTickers.map((ticker) => (
          <tr
            key={ticker.id}
            className="cursor-pointer border-b hover:bg-muted/30"
            style={{
              backgroundColor:
                highlightSymbol &&
                ticker.symbol.toUpperCase() === highlightSymbol.trim().toUpperCase()
                  ? `${cssVariables.overlayColor}33`
                  : undefined,
            }}
            onClick={() => onRowClick(ticker.symbol)}
          >
            {columns.map((c) => renderCell(c.id, ticker))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
