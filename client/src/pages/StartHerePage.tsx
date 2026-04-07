import { useCallback, useLayoutEffect, useRef, useState } from "react";
import "react-grid-layout/css/styles.css";
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
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import {
  paletteColorAt,
  startHereVisibleGridRowCount,
  START_HERE_RGL_CONTAINER_PADDING,
  START_HERE_RGL_MARGIN,
  START_HERE_RGL_ROW_HEIGHT,
} from "@/components/start-here/dashboard-persistence";

const GridLayoutWithWidth = WidthProvider(ReactGridLayout);

const WIDGET_MENU: { type: StartHereWidgetType; label: string }[] = [
  { type: "watchlist", label: "Watchlist" },
  { type: "chart", label: "Chart preview" },
  { type: "news", label: "News" },
];

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
          className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
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
              onClick={() => {
                deleteStart(activeStartId);
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
  const {
    userId,
    activeStartId,
    dashboard,
    setLayout,
    addWidget,
    removeInstance,
    resetDashboard,
    setGridViewportRowCapacity,
  } = useStartHere();

  const gridViewportRef = useRef<HTMLDivElement>(null);

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

  const onLayoutChange = useCallback(
    (next: Layout) => {
      setLayout(next);
    },
    [setLayout]
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{ backgroundColor: cssVariables.backgroundColor }}
    >
      <div
        className="flex flex-shrink-0 items-center gap-2 border-b px-4 py-2"
        style={{
          borderColor: `${cssVariables.secondaryOverlayColor}44`,
          backgroundColor: cssVariables.headerBg,
        }}
      >
        <h1
          className="font-semibold shrink-0"
          style={{ color: cssVariables.textColorTitle, fontSize: cssVariables.fontSizeTitle }}
        >
          Start
        </h1>
        <StartWorkspaceToolbar />
        <span
          className="hidden min-w-0 flex-1 text-pretty lg:inline"
          style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}
        >
          Drag to move; resize from the corner. Layout does not auto-pack—leave empty space if you want.
          Same color group = linked symbol. Each workspace keeps its own layout and widget settings.
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

      <div ref={gridViewportRef} className="min-h-0 flex-1 overflow-auto p-2">
        <GridLayoutWithWidth
          className="min-h-[calc(100vh-8rem)]"
          layout={dashboard.layout}
          cols={12}
          rowHeight={START_HERE_RGL_ROW_HEIGHT}
          margin={START_HERE_RGL_MARGIN}
          containerPadding={START_HERE_RGL_CONTAINER_PADDING}
          onLayoutChange={onLayoutChange}
          draggableHandle=".start-here-drag-handle"
          draggableCancel=".start-here-no-drag"
          compactType={null}
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
            const accentColor = g ? paletteColorAt(g.colorIndex) : undefined;
            const onClose = () => removeInstance(item.i);
            return (
              <div key={item.i} className="h-full overflow-hidden">
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
              </div>
            );
          })}
        </GridLayoutWithWidth>
      </div>
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
    <div className="flex h-screen flex-col overflow-hidden" style={cssVariables as any}>
      <SentinelHeader showSentiment={false} />
      <StartHereProvider key={user.id} userId={user.id}>
        <StartHereGridHost />
      </StartHereProvider>
    </div>
  );
}
