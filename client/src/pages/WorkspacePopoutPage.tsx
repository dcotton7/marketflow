import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent,
} from "react";
import { useLocation } from "wouter";
import "react-grid-layout/css/styles.css";
import "./start-here-rgl-overrides.css";
import ReactGridLayout, { WidthProvider, type Layout } from "react-grid-layout/legacy";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import {
  StartHereProvider,
  useStartHere,
} from "@/components/start-here/StartHereContext";
import { WatchlistPortalWidget } from "@/components/start-here/WatchlistPortalWidget";
import { ChartPreviewWidget } from "@/components/start-here/ChartPreviewWidget";
import { NewsPortalWidget } from "@/components/start-here/NewsPortalWidget";
import { StartHereFlowWidget } from "@/components/start-here/StartHereFlowWidget";
import { LiveThemeChartsWidget } from "@/components/start-here/LiveThemeChartsWidget";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ExternalLink,
  FileText,
  LayoutGrid,
  LineChart,
  Loader2,
  MonitorDown,
  Plus,
} from "lucide-react";
import { IndicatorsFourSquaresIcon } from "@/components/chart/ChartToolbarIcons";
import { MiniMaSettingsDialog } from "@/components/MiniMaSettingsDialog";
import { isMiniMaSettingsEnabled } from "@/lib/chart-preferences-shared";
import { cn } from "@/lib/utils";
import { useMarketSurgeSync } from "@/hooks/useMarketSurgeSync";
import { useChartPopout } from "@/hooks/useChartPopout";
import { AnalysisPanel } from "@/features/marketflow-analysis";
import {
  chartWallColumnsLabel,
  computeStartHereLayoutMins,
  groupLinkAccent,
  listStartHereChartWallColumnOptions,
  parseStartHereChartWallColumns,
  startHereGridViewportMetrics,
  START_HERE_RGL_CONTAINER_PADDING,
  START_HERE_RGL_MARGIN,
  START_HERE_RGL_ROW_HEIGHT,
  type StartHereWidgetType,
} from "@/components/start-here/dashboard-persistence";

const GridLayoutWithWidth = WidthProvider(ReactGridLayout);

type GridLayoutWithWidthProps = ComponentProps<typeof GridLayoutWithWidth>;
type RglResizeStop = NonNullable<GridLayoutWithWidthProps["onResizeStop"]>;
type RglDragStop = NonNullable<GridLayoutWithWidthProps["onDragStop"]>;
type RglItemCallback = NonNullable<GridLayoutWithWidthProps["onDragStart"]>;

function mergeItemIntoLayout(layout: Layout, item: Layout[number]): Layout {
  return layout.map((l) => {
    if (l.i !== item.i) return l;
    return {
      ...l,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      ...(item.minW != null ? { minW: item.minW } : {}),
      ...(item.minH != null ? { minH: item.minH } : {}),
    };
  }) as Layout;
}

const WIDGET_MENU: { type: StartHereWidgetType; label: string }[] = [
  { type: "watchlist", label: "Watchlist" },
  { type: "chart", label: "Chart" },
  { type: "news", label: "News" },
  { type: "flow", label: "Market Flow" },
  { type: "themeCharts", label: "Live Theme Charts" },
];

const START_HERE_GRID_OVERLAP_ENABLED = false;

function PopoutGridHost() {
  const { cssVariables, pageShellStyle } = useSystemSettings();
  const [, navigate] = useLocation();
  const { syncToMarketSurge } = useMarketSurgeSync();
  const { syncToChart } = useChartPopout();
  const {
    userId,
    activeStartId,
    startProfiles,
    dashboard,
    setLayout,
    addWidget,
    addLinkedChartTriplet,
    removeInstance,
    resetDashboard,
    setGridViewportMetrics,
    chartWallColumns,
    setChartWallColumns,
    workspacePalette,
  } = useStartHere();

  const [msSyncEnabled, setMsSyncEnabled] = useState(false);
  const [chartSyncEnabled, setChartSyncEnabled] = useState(false);
  const [analysisSyncEnabled, setAnalysisSyncEnabled] = useState(false);
  const [analysisSheetSymbol, setAnalysisSheetSymbol] = useState<string | null>(null);
  const [miniMaSettingsOpen, setMiniMaSettingsOpen] = useState(false);
  const miniMaSettingsEnabled = isMiniMaSettingsEnabled();

  const currentProfile = startProfiles.find((p) => p.id === activeStartId);

  const handleChartsSymbolAction = useCallback(
    (symbol: string) => {
      const s = symbol.trim();
      if (!s) return;
      if (analysisSyncEnabled) setAnalysisSheetSymbol(s);
      if (msSyncEnabled) syncToMarketSurge(s, "day");
      if (chartSyncEnabled) syncToChart(s);
      if (!msSyncEnabled && !chartSyncEnabled && !analysisSyncEnabled) {
        window.open(`/sentinel/charts?symbol=${encodeURIComponent(s)}`, "main-app");
      }
    },
    [analysisSyncEnabled, chartSyncEnabled, msSyncEnabled, navigate, syncToChart, syncToMarketSurge]
  );

  const gridViewportRef = useRef<HTMLDivElement>(null);
  const [gridRowHeight, setGridRowHeight] = useState(START_HERE_RGL_ROW_HEIGHT);
  const instancesRef = useRef(dashboard.instances);
  instancesRef.current = dashboard.instances;

  const [stackBoostId, setStackBoostId] = useState<string | null>(null);
  const [stackSeq, setStackSeq] = useState(0);
  const bringTileToFront = useCallback((id: string) => {
    setStackBoostId(id);
    setStackSeq((s) => s + 1);
  }, []);

  const rglTrustRef = useRef(false);
  const rglTrustClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tileResizeCommitRef = useRef<{ i: string; w: number; h: number } | null>(null);
  const tileResizeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = gridViewportRef.current;
    if (!el) {
      setGridViewportMetrics(undefined);
      setGridRowHeight(START_HERE_RGL_ROW_HEIGHT);
      return;
    }
    const apply = () => {
      const metrics = startHereGridViewportMetrics(el.clientWidth, el.clientHeight, chartWallColumns);
      setGridViewportMetrics(metrics);
      setGridRowHeight(metrics.suggestedRowHeight);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => {
      ro.disconnect();
      setGridViewportMetrics(undefined);
      setGridRowHeight(START_HERE_RGL_ROW_HEIGHT);
    };
  }, [setGridViewportMetrics, chartWallColumns]);

  useLayoutEffect(() => {
    return () => {
      if (rglTrustClearTimerRef.current != null) clearTimeout(rglTrustClearTimerRef.current);
      if (tileResizeCommitTimerRef.current != null) clearTimeout(tileResizeCommitTimerRef.current);
    };
  }, []);

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (rglTrustRef.current) { setLayout(next, { trustRgl: true }); return; }
      const commit = tileResizeCommitRef.current;
      if (commit) {
        const live = next.find((l) => l.i === commit.i);
        if (live && instancesRef.current[commit.i] && (live.w > commit.w || live.h > commit.h)) {
          const meta = instancesRef.current[commit.i];
          const { minW, minH } = computeStartHereLayoutMins(commit.w, commit.h, meta.type);
          const fixed = next.map((l) =>
            l.i === commit.i ? { ...live, w: commit.w, h: commit.h, minW, minH } : l
          ) as Layout;
          setLayout(fixed, { trustRgl: true });
          return;
        }
      }
      setLayout(next, { trustRgl: false });
    },
    [setLayout]
  );

  const finishInteractionTrustWindow = useCallback(() => {
    if (rglTrustClearTimerRef.current != null) clearTimeout(rglTrustClearTimerRef.current);
    rglTrustRef.current = true;
    rglTrustClearTimerRef.current = setTimeout(() => {
      rglTrustRef.current = false;
      rglTrustClearTimerRef.current = null;
    }, 400);
  }, []);

  const onDragStart = useCallback<RglItemCallback>(
    (_layout, _oldItem, newItem) => {
      rglTrustRef.current = true;
      if (START_HERE_GRID_OVERLAP_ENABLED && newItem?.i) bringTileToFront(newItem.i);
    },
    [bringTileToFront]
  );

  const onResizeStart = useCallback<RglItemCallback>(
    (_layout, _oldItem, newItem) => {
      rglTrustRef.current = true;
      if (tileResizeCommitTimerRef.current != null) {
        clearTimeout(tileResizeCommitTimerRef.current);
        tileResizeCommitTimerRef.current = null;
      }
      tileResizeCommitRef.current = null;
      if (START_HERE_GRID_OVERLAP_ENABLED && newItem?.i) bringTileToFront(newItem.i);
    },
    [bringTileToFront]
  );

  const onResizeStop = useCallback<RglResizeStop>(
    (layout, _oldItem, newItem) => {
      const merged = newItem ? mergeItemIntoLayout(layout, newItem) : layout;
      if (newItem && instancesRef.current[newItem.i]) {
        tileResizeCommitRef.current = { i: newItem.i, w: newItem.w, h: newItem.h };
        if (tileResizeCommitTimerRef.current != null) clearTimeout(tileResizeCommitTimerRef.current);
        tileResizeCommitTimerRef.current = setTimeout(() => {
          tileResizeCommitRef.current = null;
          tileResizeCommitTimerRef.current = null;
        }, 1200);
      }
      setLayout(merged, { trustRgl: true });
      finishInteractionTrustWindow();
    },
    [setLayout, finishInteractionTrustWindow]
  );

  const onDragStop = useCallback<RglDragStop>(
    (layout, _oldItem, newItem) => {
      const merged = newItem ? mergeItemIntoLayout(layout, newItem) : layout;
      setLayout(merged, { trustRgl: true });
      finishInteractionTrustWindow();
    },
    [setLayout, finishInteractionTrustWindow]
  );

  const onViewportPointerDownCapture = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!START_HERE_GRID_OVERLAP_ENABLED || !e.altKey) return;
      const root = gridViewportRef.current;
      if (!root?.contains(e.target as Node)) return;
      const hits = document.elementsFromPoint(e.clientX, e.clientY);
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const el of hits) {
        const node = (el as HTMLElement).closest?.("[data-sh-instance]");
        if (!node || !root.contains(node)) continue;
        const id = node.getAttribute("data-sh-instance");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      if (ids.length >= 2) {
        bringTileToFront(ids[ids.length - 1]!);
        e.preventDefault();
      }
    },
    [bringTileToFront]
  );

  const handleDock = useCallback(() => window.close(), []);

  return (
    <div
      className="flex h-dvh min-h-0 min-w-0 flex-col sentinel-page"
      style={pageShellStyle as React.CSSProperties}
    >
      {/* Thin title bar */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5"
        style={{ backgroundColor: cssVariables.headerBg, borderColor: cssVariables.borderOnSecondary }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <LayoutGrid className="h-4 w-4 text-cyan-400 shrink-0" />
          <span
            className="font-semibold text-sm truncate"
            style={{ color: cssVariables.textTitle }}
            title={currentProfile?.name ?? "Workspace"}
          >
            {currentProfile?.name ?? "Workspace"}
          </span>
          <span className="text-[9px] text-slate-600 hidden sm:inline" title="Pin this window on top: Win+Ctrl+T (requires Windows PowerToys)">
            📌 Win+Ctrl+T to pin on top
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-6 text-xs text-slate-400 hover:text-cyan-400"
          onClick={handleDock}
          title="Close pop-out and return to main window"
        >
          <MonitorDown className="h-3.5 w-3.5" />
          Dock
        </Button>
      </div>

      {/* On-click action bar */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1"
        style={{ backgroundColor: `${cssVariables.secondaryOverlayColor}14` }}
      >
        <span className="text-xs text-muted-foreground" style={{ fontSize: cssVariables.fontSizeSmall }}>
          On Click:
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center rounded px-3 py-1 text-xs transition-colors",
                msSyncEnabled
                  ? "border border-blue-500/30 bg-blue-500/20 text-blue-400"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setMsSyncEnabled((v) => !v)}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              MarketSurge
            </button>
          </TooltipTrigger>
          <TooltipContent>Open MarketSurge in a popup window</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center rounded px-3 py-1 text-xs transition-colors",
                chartSyncEnabled
                  ? "border border-cyan-500/30 bg-cyan-500/20 text-cyan-400"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setChartSyncEnabled((v) => !v)}
            >
              <LineChart className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              Internal Charts
            </button>
          </TooltipTrigger>
          <TooltipContent>Open internal charts in a popup window</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center rounded px-3 py-1 text-xs transition-colors",
                analysisSyncEnabled
                  ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setAnalysisSyncEnabled((v) => !v)}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              Analysis
            </button>
          </TooltipTrigger>
          <TooltipContent>Open MarketFlow AI analysis in a side panel</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex items-center gap-2">
          {miniMaSettingsEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 text-[10px] text-slate-400 hover:text-cyan-400"
                  onClick={() => setMiniMaSettingsOpen(true)}
                >
                  <IndicatorsFourSquaresIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">Indicators</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mini chart indicator settings</TooltipContent>
            </Tooltip>
          )}
          <div className="flex items-center gap-1">
            <LayoutGrid className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <Select
              value={String(chartWallColumns)}
              onValueChange={(v) => setChartWallColumns(parseStartHereChartWallColumns(v))}
            >
              <SelectTrigger className="start-here-no-drag h-6 w-[min(120px,30vw)] text-[10px]">
                <SelectValue placeholder="Chart wall" />
              </SelectTrigger>
              <SelectContent align="end">
                {listStartHereChartWallColumnOptions().map((opt) => (
                  <SelectItem key={String(opt)} value={String(opt)} className="text-xs">
                    {chartWallColumnsLabel(opt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="gap-1 h-6 text-[10px] text-slate-400 hover:text-cyan-400">
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={addLinkedChartTriplet}>4 Linked Charts</DropdownMenuItem>
              {WIDGET_MENU.map(({ type, label }) => (
                <DropdownMenuItem key={type} onClick={() => addWidget(type)}>{label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] text-slate-400 hover:text-cyan-400" onClick={resetDashboard}>
            Reset
          </Button>
        </div>
      </div>

      {/* Grid viewport */}
      <div
        ref={gridViewportRef}
        className="min-h-0 min-w-0 flex-1 overflow-auto p-1"
        onPointerDownCapture={START_HERE_GRID_OVERLAP_ENABLED ? onViewportPointerDownCapture : undefined}
      >
        {dashboard.layout.length === 0 ? (
          <div className="flex min-h-[calc(100vh-5rem)] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">No widgets on this workspace</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Use <span className="font-medium text-foreground">Add</span> above to add widgets.
            </p>
          </div>
        ) : (
          <GridLayoutWithWidth
            className="start-here-rgl min-h-[calc(100vh-5rem)] min-w-0 w-full"
            layout={dashboard.layout}
            cols={12}
            measureBeforeMount
            rowHeight={gridRowHeight}
            margin={START_HERE_RGL_MARGIN}
            containerPadding={START_HERE_RGL_CONTAINER_PADDING}
            onLayoutChange={onLayoutChange}
            onDragStart={onDragStart}
            onDragStop={onDragStop}
            onResizeStart={onResizeStart}
            onResizeStop={onResizeStop}
            draggableHandle=".start-here-drag-handle"
            draggableCancel=".start-here-no-drag"
            compactType={null}
            allowOverlap={START_HERE_GRID_OVERLAP_ENABLED}
            preventCollision={!START_HERE_GRID_OVERLAP_ENABLED}
            isResizable
            isDraggable
          >
            {dashboard.layout.map((item) => {
              const meta = dashboard.instances[item.i];
              if (!meta) {
                return (
                  <div key={item.i} className="h-full rounded border border-dashed p-2 text-xs text-muted-foreground">
                    Unknown widget
                  </div>
                );
              }
              const g = dashboard.groups[meta.groupId];
              const accentColor = g ? groupLinkAccent(meta.groupId, workspacePalette, g).accentColor : undefined;
              const onClose = () => removeInstance(item.i);
              const zBase = stackBoostId === item.i ? 100 + stackSeq : 1;
              return (
                <div
                  key={item.i}
                  data-sh-instance={item.i}
                  className="h-full overflow-hidden"
                  style={START_HERE_GRID_OVERLAP_ENABLED ? { zIndex: zBase } : undefined}
                >
                  {meta.type === "watchlist" && (
                    <WatchlistPortalWidget
                      key={`${activeStartId}-${item.i}-${meta.groupId}`}
                      cssVariables={cssVariables}
                      userId={userId}
                      instanceId={item.i}
                      groupId={meta.groupId}
                      accentColor={accentColor}
                      onClose={onClose}
                    />
                  )}
                  {meta.type === "chart" && (
                    <ChartPreviewWidget
                      key={`${activeStartId}-${item.i}`}
                      cssVariables={cssVariables}
                      instanceId={item.i}
                      groupId={meta.groupId}
                      accentColor={accentColor}
                      onClose={onClose}
                      onChartsSymbolAction={handleChartsSymbolAction}
                    />
                  )}
                  {meta.type === "news" && (
                    <NewsPortalWidget
                      key={`${activeStartId}-${item.i}`}
                      cssVariables={cssVariables}
                      userId={userId}
                      instanceId={item.i}
                      groupId={meta.groupId}
                      accentColor={accentColor}
                      onClose={onClose}
                    />
                  )}
                  {meta.type === "flow" && (
                    <StartHereFlowWidget
                      key={`${activeStartId}-${item.i}`}
                      cssVariables={cssVariables}
                      instanceId={item.i}
                      groupId={meta.groupId}
                      accentColor={accentColor}
                      onClose={onClose}
                    />
                  )}
                  {meta.type === "themeCharts" && (
                    <LiveThemeChartsWidget
                      key={`${activeStartId}-${item.i}`}
                      cssVariables={cssVariables}
                      instanceId={item.i}
                      groupId={meta.groupId}
                      accentColor={accentColor}
                      onClose={onClose}
                    />
                  )}
                </div>
              );
            })}
          </GridLayoutWithWidth>
        )}
      </div>

      <AnalysisPanel
        variant="floating"
        symbol={analysisSheetSymbol}
        open={analysisSheetSymbol !== null}
        onOpenChange={(open) => !open && setAnalysisSheetSymbol(null)}
      />
      {miniMaSettingsEnabled && (
        <MiniMaSettingsDialog open={miniMaSettingsOpen} onOpenChange={setMiniMaSettingsOpen} />
      )}
    </div>
  );
}

export default function WorkspacePopoutPage() {
  const { user, isLoading: authLoading } = useSentinelAuth();
  const { pageShellStyle } = useSystemSettings();

  if (authLoading) {
    return (
      <div
        className="flex h-dvh items-center justify-center sentinel-page"
        style={pageShellStyle as React.CSSProperties}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex h-dvh items-center justify-center sentinel-page"
        style={pageShellStyle as React.CSSProperties}
      >
        <p className="text-sm text-muted-foreground">Not authenticated. Open the main app first.</p>
      </div>
    );
  }

  return (
    <StartHereProvider key={user.id} userId={user.id}>
      <PopoutGridHost />
    </StartHereProvider>
  );
}
