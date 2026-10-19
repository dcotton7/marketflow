import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import "react-grid-layout/css/styles.css";
import "./start-here-rgl-overrides.css";
import ReactGridLayout, { WidthProvider, type Layout } from "react-grid-layout/legacy";
import { Maximize2, Plus, X } from "lucide-react";
import { MiniChart, formatMiniChartLastPrice, type MiniChartQuoteSummary, type StartHereInterval } from "@/components/MiniChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { onHostCommand, postToHost, type EmbedChart } from "@/lib/embed-host";
import { cn } from "@/lib/utils";

const GridLayoutWithWidth = WidthProvider(ReactGridLayout);

const INTERVALS: StartHereInterval[] = ["1d", "30m", "15m", "5m"];
const SYMBOL_RX = /^[A-Z0-9.\-^/]{1,12}$/;

interface ChartTile {
  i: string;
  symbol: string;
  interval: StartHereInterval;
}

type LayoutItem = Layout[number];

interface SavedState {
  tiles: ChartTile[];
  layout: LayoutItem[];
}

const storageKey = (panel: string) => `mf-embed-charts:${panel}`;

function loadState(panel: string): SavedState {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(panel)) || "null") as SavedState | null;
    if (v && Array.isArray(v.tiles) && Array.isArray(v.layout)) return v;
  } catch {
    /* fresh panel */
  }
  return { tiles: [], layout: [] };
}

const newId = (n: number) => `c${Date.now().toString(36)}${n.toString(36)}`;

/** Host charts onto the current state: replace, or add the tickers not already shown. */
function applyCharts(s: SavedState, charts: EmbedChart[], add: boolean): SavedState {
  const base = add ? s : { tiles: [], layout: [] };
  const have = new Set(base.tiles.map((t) => t.symbol));
  const tiles = [...base.tiles];
  const layout = [...base.layout];
  charts.forEach((c, n) => {
    if (have.has(c.symbol)) return;
    have.add(c.symbol);
    const i = newId(n);
    const interval = INTERVALS.includes(c.interval as StartHereInterval) ? (c.interval as StartHereInterval) : "1d";
    tiles.push({ i, symbol: c.symbol, interval });
    const placed = c.x != null && c.y != null && c.w != null && c.h != null;
    layout.push({
      i,
      x: placed ? Math.min(c.x!, 11) : ((tiles.length - 1) * 4) % 12,
      y: placed ? c.y! : Infinity,
      w: placed ? Math.max(2, Math.min(c.w!, 12)) : 4,
      h: placed ? Math.max(4, c.h!) : 7,
      minW: 2,
      minH: 4,
    });
  });
  return { tiles, layout };
}

function openBig(symbol: string) {
  if (!postToHost({ type: "open-big", symbol })) {
    window.open(`/embed/big-chart?symbol=${encodeURIComponent(symbol)}`, "MarketFlowBigChart", "width=1400,height=900,popup=yes");
  }
}

function Tile({
  tile,
  onRemove,
  onInterval,
}: {
  tile: ChartTile;
  onRemove: () => void;
  onInterval: (iv: StartHereInterval) => void;
}) {
  const [quote, setQuote] = useState<MiniChartQuoteSummary | null>(null);
  const onQuote = useCallback((q: MiniChartQuoteSummary | null) => setQuote(q), []);
  const pct = quote?.changePct;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-slate-700/70 bg-slate-900/80">
      <div className="embed-drag-handle flex shrink-0 cursor-move items-center gap-1.5 border-b border-slate-700/60 px-2 py-1">
        <span className="font-mono text-xs font-semibold text-slate-100">{tile.symbol}</span>
        {quote?.lastPrice != null && (
          <span className="font-mono text-[11px] tabular-nums text-slate-300">{formatMiniChartLastPrice(quote.lastPrice)}</span>
        )}
        {pct != null && Number.isFinite(pct) && (
          <span className={cn("font-mono text-[11px] tabular-nums", pct >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </span>
        )}
        <div className="embed-no-drag ml-auto flex items-center gap-0.5">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => onInterval(iv)}
              className={cn(
                "rounded px-1 text-[10px] font-medium",
                tile.interval === iv ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {iv.toUpperCase()}
            </button>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => openBig(tile.symbol)} className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-cyan-300">
                <Maximize2 className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Open the big two-chart view</TooltipContent>
          </Tooltip>
          <button type="button" onClick={onRemove} className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-rose-300" aria-label={`Remove ${tile.symbol}`}>
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="embed-no-drag flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden p-1" onDoubleClick={() => openBig(tile.symbol)}>
        <MiniChart
          symbol={tile.symbol}
          timeframe="50D"
          movingAverages2150200
          startHereInterval={tile.interval}
          fillContainer
          hideChangeFooter
          onQuoteSummaryChange={onQuote}
        />
      </div>
    </div>
  );
}

/**
 * /embed/charts — MarketFlow mini charts for an Anima Lab panel. Add any number of tickers; each chart can be
 * dragged and resized. Double-click a chart (or its expand icon) to open the big two-chart view.
 * `?panel=<id>` keeps a separate chart set per Anima panel. The host may send { source: "anima", type: "set-charts" }
 * to replace (or add to) the tickers; every change is reported back as "charts-state".
 */
export default function EmbedChartsPage() {
  const search = useSearch();
  const panel = useMemo(() => new URLSearchParams(search).get("panel")?.slice(0, 60) || "default", [search]);
  const [state, setState] = useState<SavedState>(() => loadState(panel));
  const [ticker, setTicker] = useState("");

  useEffect(() => {
    localStorage.setItem(storageKey(panel), JSON.stringify(state));
    const at = new Map(state.layout.map((l) => [l.i, l]));
    postToHost({
      type: "charts-state",
      charts: state.tiles.map((t) => {
        const l = at.get(t.i);
        return { symbol: t.symbol, interval: t.interval, x: l?.x, y: l?.y, w: l?.w, h: l?.h };
      }),
    });
  }, [panel, state]);

  useEffect(() => {
    const off = onHostCommand((cmd) => {
      if (cmd.type === "set-charts") setState((s) => applyCharts(s, cmd.charts, cmd.add));
    });
    postToHost({ type: "ready", page: "charts" });
    return off;
  }, []);

  const typed = ticker.trim().toUpperCase().replace(/^\$/, "");
  const valid = SYMBOL_RX.test(typed);

  const addChart = () => {
    if (!valid) return;
    const i = `c${Date.now().toString(36)}`;
    setState((s) => ({
      tiles: [...s.tiles, { i, symbol: typed, interval: "1d" }],
      layout: [...s.layout, { i, x: (s.tiles.length * 4) % 12, y: Infinity, w: 4, h: 7, minW: 2, minH: 4 }],
    }));
    setTicker("");
  };

  const removeChart = (i: string) =>
    setState((s) => ({ tiles: s.tiles.filter((t) => t.i !== i), layout: s.layout.filter((l) => l.i !== i) }));

  const setTileInterval = (i: string, interval: StartHereInterval) =>
    setState((s) => ({ ...s, tiles: s.tiles.map((t) => (t.i === i ? { ...t, interval } : t)) }));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-800 px-2 py-1.5">
        <Input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") addChart();
          }}
          placeholder="Ticker"
          className="h-7 w-28 border-slate-700 bg-slate-900 font-mono text-xs uppercase"
          data-testid="embed-charts-ticker"
        />
        <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={addChart} disabled={!valid} data-testid="embed-charts-add">
          <Plus className="h-3.5 w-3.5" /> Add chart
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-slate-700 px-2 text-xs"
          onClick={() => {
            if (!valid) return;
            openBig(typed);
            setTicker("");
          }}
          disabled={!valid}
          data-testid="embed-charts-big"
        >
          <Maximize2 className="h-3.5 w-3.5" /> Big
        </Button>
        <span className="ml-auto text-[10px] text-slate-500">{state.tiles.length} chart{state.tiles.length === 1 ? "" : "s"}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {state.tiles.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-xs text-slate-500">
            <span className="text-slate-300">No charts yet.</span>
            <span>Type a ticker and press Enter to add a mini chart, or Big for the two-chart view.</span>
          </div>
        ) : (
          <GridLayoutWithWidth
            className="start-here-rgl min-w-0 w-full"
            layout={state.layout}
            cols={12}
            rowHeight={28}
            margin={[6, 6]}
            containerPadding={[2, 2]}
            draggableHandle=".embed-drag-handle"
            draggableCancel=".embed-no-drag"
            onLayoutChange={(layout: Layout) => setState((s) => ({ ...s, layout: [...layout] }))}
            isResizable
            isDraggable
          >
            {state.tiles.map((t) => (
              <div key={t.i}>
                <Tile tile={t} onRemove={() => removeChart(t.i)} onInterval={(iv) => setTileInterval(t.i, iv)} />
              </div>
            ))}
          </GridLayoutWithWidth>
        )}
      </div>
    </div>
  );
}
