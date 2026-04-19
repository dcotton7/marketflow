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
import { SentinelHeader } from "@/components/SentinelHeader";
import {
  StartHereProvider,
  useStartHere,
  type StartHereWidgetType,
} from "@/components/start-here/StartHereContext";
import { WatchlistPortalWidget } from "@/components/start-here/WatchlistPortalWidget";
import { ChartPreviewWidget } from "@/components/start-here/ChartPreviewWidget";
import { NewsPortalWidget } from "@/components/start-here/NewsPortalWidget";
import { StartHereFlowWidget } from "@/components/start-here/StartHereFlowWidget";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Copy, ExternalLink, FileText, LineChart, Pencil, Plus, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMarketSurgeSync } from "@/hooks/useMarketSurgeSync";
import { useChartPopout } from "@/hooks/useChartPopout";
import { AnalysisPanel } from "@/features/marketflow-analysis";
import {
  computeStartHereLayoutMins,
  groupLinkAccent,
  startHereVisibleGridRowCount,
  START_HERE_RGL_CONTAINER_PADDING,
  START_HERE_RGL_MARGIN,
  START_HERE_RGL_ROW_HEIGHT,
} from "@/components/start-here/dashboard-persistence";

const GridLayoutWithWidth = WidthProvider(ReactGridLayout);

type GridLayoutWithWidthProps = ComponentProps<typeof GridLayoutWithWidth>;
type RglResizeStop = NonNullable<GridLayoutWithWidthProps["onResizeStop"]>;
type RglDragStop = NonNullable<GridLayoutWithWidthProps["onDragStop"]>;
type RglItemCallback = NonNullable<GridLayoutWithWidthProps["onDragStart"]>;

/** Apply RGL's resize/drag result item onto the layout array (layout[] can disagree with newItem). */
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
];

/** False: standard non-overlapping grid. Stacking helpers stay for a future notes/overlap mode. */
const START_HERE_GRID_OVERLAP_ENABLED = false;

function StartWorkspaceToolbar() {
  const {
    activeStartId,
    startProfiles,
    switchStart,
    createStart,
    duplicateActiveStart,
    renameStart,
    deleteStart,
  } = useStartHere();
  const [newOpen, setNewOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const current = startProfiles.find((p) => p.id === activeStartId);
  const canDelete = startProfiles.length > 1;

  const openNew = () => {
    setNameInput("New Start");
    setNewOpen(true);
  };
  const openDup = () => {
    setNameInput(`${current?.name ?? "Start"} copy`);
    setDupOpen(true);
  };
  const openRename = () => {
    setNameInput(current?.name ?? "");
    setRenameOpen(true);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs whitespace-nowrap">Workspace</span>
        <Select value={activeStartId} onValueChange={switchStart}>
          <SelectTrigger className="start-here-no-drag h-8 w-[min(220px,42vw)] text-xs">
            <SelectValue placeholder="Select workspace" />
          </SelectTrigger>
          <SelectContent>
            {startProfiles.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={openDup}>
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={openRename}>
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 border-border bg-white text-xs text-destructive shadow-sm hover:bg-neutral-100 hover:text-destructive"
          disabled={!canDelete}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="start-here-no-drag sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
          <Input
            id="start-here-workspace-name-new"
            name="startHereWorkspaceNameNew"
            className="start-here-no-drag"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                createStart(nameInput);
                setNewOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                createStart(nameInput);
                setNewOpen(false);
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="start-here-no-drag sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate workspace</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Copies layout, widgets, watchlist picks, and news view settings from the current workspace.
          </p>
          <Input
            id="start-here-workspace-name-dup"
            name="startHereWorkspaceNameDup"
            className="start-here-no-drag"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                duplicateActiveStart(nameInput);
                setDupOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDupOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                duplicateActiveStart(nameInput);
                setDupOpen(false);
              }}
            >
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="start-here-no-drag sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename workspace</DialogTitle>
          </DialogHeader>
          <Input
            id="start-here-workspace-name-rename"
            name="startHereWorkspaceNameRename"
            className="start-here-no-drag"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameStart(activeStartId, nameInput);
                setRenameOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                renameStart(activeStartId, nameInput);
                setRenameOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="start-here-no-drag">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {current
                ? `“${current.name}” and all of its saved layout and widget settings will be removed. This cannot be undone.`
                : "This workspace will be removed. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                await deleteStart(activeStartId);
                setDeleteOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StartHereGridHost() {
  const { cssVariables } = useSystemSettings();
  const [, navigate] = useLocation();
  const { syncToMarketSurge } = useMarketSurgeSync();
  const { syncToChart } = useChartPopout();
  const {
    userId,
    activeStartId,
    dashboard,
    setLayout,
    addWidget,
    addLinkedChartTriplet,
    removeInstance,
    resetDashboard,
    setGridViewportRowCapacity,
    workspacePalette,
  } = useStartHere();

  const [msSyncEnabled, setMsSyncEnabled] = useState(false);
  const [chartSyncEnabled, setChartSyncEnabled] = useState(false);
  const [analysisSyncEnabled, setAnalysisSyncEnabled] = useState(false);
  const [analysisSheetSymbol, setAnalysisSheetSymbol] = useState<string | null>(null);

  const handleChartsSymbolAction = useCallback(
    (symbol: string) => {
      const s = symbol.trim();
      if (!s) return;
      if (analysisSyncEnabled) {
        setAnalysisSheetSymbol(s);
      }
      if (msSyncEnabled) {
        syncToMarketSurge(s, "day");
      }
      if (chartSyncEnabled) {
        syncToChart(s);
      }
      if (!msSyncEnabled && !chartSyncEnabled && !analysisSyncEnabled) {
        navigate(`/sentinel/charts?symbol=${encodeURIComponent(s)}`);
      }
    },
    [
      analysisSyncEnabled,
      chartSyncEnabled,
      msSyncEnabled,
      navigate,
      syncToChart,
      syncToMarketSurge,
    ]
  );

  const gridViewportRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef(dashboard.instances);
  instancesRef.current = dashboard.instances;

  /** Manual stacking when tiles overlap (RGL merges child `style` onto `.react-grid-item`). */
  const [stackBoostId, setStackBoostId] = useState<string | null>(null);
  const [stackSeq, setStackSeq] = useState(0);
  const bringTileToFront = useCallback((id: string) => {
    setStackBoostId(id);
    setStackSeq((s) => s + 1);
  }, []);

  /** True while user is dragging or resizing any tile — RGL can emit bogus w=12 for Flow on mount otherwise. */
  const rglTrustRef = useRef(false);
  const rglTrustClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** After any tile resize stop, RGL often sends onLayoutChange that re-expands w/h — clamp back until next resize or timeout. */
  const tileResizeCommitRef = useRef<{ i: string; w: number; h: number } | null>(null);
  const tileResizeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = gridViewportRef.current;
    if (!el) {
      setGridViewportRowCapacity(undefined);
      return;
    }
    const apply = () => {
      setGridViewportRowCapacity(startHereVisibleGridRowCount(el.clientHeight));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => {
      ro.disconnect();
      setGridViewportRowCapacity(undefined);
    };
  }, [setGridViewportRowCapacity]);

  useLayoutEffect(() => {
    return () => {
      if (rglTrustClearTimerRef.current != null) {
        clearTimeout(rglTrustClearTimerRef.current);
      }
      if (tileResizeCommitTimerRef.current != null) {
        clearTimeout(tileResizeCommitTimerRef.current);
      }
    };
  }, []);

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (rglTrustRef.current) {
        setLayout(next, { trustRgl: true });
        return;
      }
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
    if (rglTrustClearTimerRef.current != null) {
      clearTimeout(rglTrustClearTimerRef.current);
    }
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
        if (tileResizeCommitTimerRef.current != null) {
          clearTimeout(tileResizeCommitTimerRef.current);
        }
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

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ backgroundColor: cssVariables.backgroundColor }}
    >
      <div
        className="flex flex-shrink-0 flex-col border-b"
        style={{
          borderColor: `${cssVariables.secondaryOverlayColor}44`,
          backgroundColor: cssVariables.headerBg,
        }}
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <h1
            className="shrink-0 font-semibold"
            style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }}
          >
            Start
          </h1>
          <StartWorkspaceToolbar />
          <span
            className="hidden min-w-0 flex-1 text-pretty lg:inline"
            style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}
          >
            Drag to move; resize from the corner. Layout does not auto-pack—leave empty space if you want. Tile
            overlap (e.g. for notes) is off for now. Same color group = linked symbol. Each workspace keeps its own
            layout and widget settings.
          </span>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="gap-1">
                  <Plus className="h-4 w-4" />
                  Add widget
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={addLinkedChartTriplet}>
                  3 Linked Charts
                </DropdownMenuItem>
                {WIDGET_MENU.map(({ type, label }) => (
                  <DropdownMenuItem key={type} onClick={() => addWidget(type)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" variant="secondary" onClick={resetDashboard}>
              Reset layout
            </Button>
          </div>
        </div>
        <div
          className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-1.5"
          style={{ backgroundColor: `${cssVariables.secondaryOverlayColor}14` }}
        >
          <span
            className="text-xs text-muted-foreground"
            style={{ fontSize: cssVariables.fontSizeSmall }}
          >
            Choose On Click Action:
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
            <TooltipContent>
              Open MarketSurge in a popup window. Chart &quot;Charts&quot; uses that window when enabled.
            </TooltipContent>
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
            <TooltipContent>
              Open internal charts in a popup window. Chart &quot;Charts&quot; drives that window when enabled.
            </TooltipContent>
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
                Detailed Analysis
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Open MarketFlow AI analysis in a side panel when you use Chart &quot;Charts&quot; with a symbol.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={gridViewportRef}
        className="min-h-0 min-w-0 flex-1 overflow-auto p-2"
        onPointerDownCapture={
          START_HERE_GRID_OVERLAP_ENABLED ? onViewportPointerDownCapture : undefined
        }
      >
        <GridLayoutWithWidth
          className="start-here-rgl min-h-[calc(100vh-8rem)] min-w-0 w-full"
          layout={dashboard.layout}
          cols={12}
          measureBeforeMount
          rowHeight={START_HERE_RGL_ROW_HEIGHT}
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
              </div>
            );
          })}
        </GridLayoutWithWidth>
      </div>
      <AnalysisPanel
        variant="floating"
        symbol={analysisSheetSymbol}
        open={analysisSheetSymbol !== null}
        onOpenChange={(open) => !open && setAnalysisSheetSymbol(null)}
      />
    </div>
  );
}

export default function StartHerePage() {
  const { user } = useSentinelAuth();
  const { cssVariables } = useSystemSettings();

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col" style={{ backgroundColor: cssVariables.backgroundColor }}>
        <SentinelHeader showSentiment={false} />
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 h-screen flex-col overflow-hidden"
      style={cssVariables as any}
    >
      <SentinelHeader showSentiment={false} />
      <StartHereProvider key={user.id} userId={user.id}>
        <StartHereGridHost />
      </StartHereProvider>
    </div>
  );
}
