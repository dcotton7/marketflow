import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_START_HERE_WORKSPACE_PALETTE,
  START_HERE_LINK_LANE_COUNT,
  isValidHex6,
  type StartHereWorkspacePalette,
} from "@shared/startHereWorkspacePalette";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

function normalizeHexInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const withHash = t.startsWith("#") ? t : `#${t}`;
  return withHash.slice(0, 7).toUpperCase();
}

export function WorkspacePaletteAdminPanel() {
  const { toast } = useToast();
  const { data, isLoading, isError, error, isFetching } = useQuery<StartHereWorkspacePalette>({
    queryKey: ["/api/sentinel/start-here-workspace-palette"],
  });

  const [draft, setDraft] = useState<StartHereWorkspacePalette | null>(null);

  useEffect(() => {
    if (data) {
      setDraft({
        linkLanes: data.linkLanes.map((x) => ({ ...x })),
        unlinkedColor: data.unlinkedColor,
      });
      return;
    }
    if (!isLoading && !isFetching && isError) {
      setDraft({
        linkLanes: DEFAULT_START_HERE_WORKSPACE_PALETTE.linkLanes.map((x) => ({ ...x })),
        unlinkedColor: DEFAULT_START_HERE_WORKSPACE_PALETTE.unlinkedColor,
      });
    }
  }, [data, isLoading, isFetching, isError]);

  const saveMutation = useMutation({
    mutationFn: async (body: StartHereWorkspacePalette) => {
      const res = await apiRequest("PATCH", "/api/admin/start-here-workspace-palette", body);
      return res.json() as Promise<StartHereWorkspacePalette>;
    },
    onSuccess: (saved) => {
      setDraft({
        linkLanes: saved.linkLanes.map((x) => ({ ...x })),
        unlinkedColor: saved.unlinkedColor,
      });
      queryClient.setQueryData(["/api/sentinel/start-here-workspace-palette"], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/start-here-workspace-palette"] });
      toast({ title: "Workspace colors saved", description: "Start Here link lanes update for all users after refresh or within about a minute." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const resetDraftToDefaults = () => {
    setDraft({
      linkLanes: DEFAULT_START_HERE_WORKSPACE_PALETTE.linkLanes.map((x) => ({ ...x })),
      unlinkedColor: DEFAULT_START_HERE_WORKSPACE_PALETTE.unlinkedColor,
    });
  };

  if ((isLoading || isFetching) && !draft) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading workspace palette…
      </div>
    );
  }

  if (!draft) {
    return (
      <p className="text-destructive text-sm">
        Could not load workspace palette.
        {error instanceof Error ? ` ${error.message}` : ""}
      </p>
    );
  }

  const updateLane = (index: number, patch: Partial<{ label: string; color: string }>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const linkLanes = prev.linkLanes.map((l, i) => (i === index ? { ...l, ...patch } : l));
      return { ...prev, linkLanes };
    });
  };

  const setUnlinked = (color: string) => {
    setDraft((prev) => (prev ? { ...prev, unlinkedColor: color } : prev));
  };

  const canSave =
    draft.linkLanes.length === START_HERE_LINK_LANE_COUNT &&
    draft.linkLanes.every((l) => l.label.trim().length > 0 && isValidHex6(l.color)) &&
    isValidHex6(draft.unlinkedColor);

  return (
    <Card data-testid="card-admin-workspace-palette">
      {isError ? (
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
          <p className="font-medium text-amber-100">Could not reach the palette API or the database.</p>
          <p className="mt-1 text-amber-200/90">
            The form below uses <span className="font-medium">shipped defaults</span>. Edit and save may fail until
            the server can read/write the table. From the project root run{" "}
            <code className="rounded bg-black/30 px-1 py-0.5 text-xs">npm run db:push</code> to create{" "}
            <code className="rounded bg-black/30 px-1 py-0.5 text-xs">start_here_workspace_palette</code>, then
            restart the dev server and refresh.
          </p>
          {error instanceof Error ? (
            <p className="mt-2 font-mono text-xs text-amber-200/70">{error.message}</p>
          ) : null}
        </div>
      ) : null}
      <CardHeader>
        <CardTitle>Start Here — workspace link colors</CardTitle>
        <CardDescription className="space-y-2 text-pretty">
          <p>
            These colors define the <span className="font-medium text-foreground">ten link lanes</span> on the
            Start page (watchlist/chart/news/flow group picker). Everyone sees the same palette after the app loads
            these settings.
          </p>
          <p>
            The <span className="font-medium text-foreground">Unlinked</span> swatch is for widgets in a private
            group (not on a colored lane).
          </p>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">Color picker:</span> the square opens your system color
            dialog (on Windows, the full desktop color chooser). Hex must be <code className="text-xs">#RRGGBB</code>
            .
          </p>
          <p>
            <span className="font-medium text-foreground">Tip:</span> labels are shown in the link dropdown; keep
            them short.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Link lanes (fixed order: lane 0 … lane 9)</h3>
          <ul className="space-y-3">
            {draft.linkLanes.map((lane, i) => (
              <li
                key={i}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-background/50 p-3"
              >
                <div className="flex min-w-[7rem] flex-col gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="text-xs text-muted-foreground cursor-help">Lane {i}</Label>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-pretty">
                      Fixed index <span className="font-mono">sh_lane_{i}</span>. Widgets assigned to this row share
                      ticker sync when you use broadcast from the watchlist. Color is the header stripe and border on
                      Start Here tiles.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label htmlFor={`sh-lane-label-${i}`} className="text-xs cursor-help">
                        Display name
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-pretty">
                      Shown next to the color dot in the &quot;Link&quot; dropdown. Does not affect trading data.
                    </TooltipContent>
                  </Tooltip>
                  <Input
                    id={`sh-lane-label-${i}`}
                    value={lane.label}
                    onChange={(e) => updateLane(i, { label: e.target.value })}
                    className="h-9 max-w-xs"
                    maxLength={48}
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs cursor-help">System picker</Label>
                        <input
                          type="color"
                          aria-label={`Lane ${i} color — open system color dialog`}
                          title="Opens the operating system color dialog (Windows/macOS/Linux)."
                          value={isValidHex6(lane.color) ? lane.color : "#000000"}
                          onChange={(e) => updateLane(i, { color: e.target.value.toUpperCase() })}
                          className="h-10 w-14 cursor-pointer overflow-hidden rounded-md border border-input bg-background p-0"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-pretty">
                      Native color input: on Windows this opens the standard color dialog (custom colors, eyedropper on
                      supported builds). The value is saved as{" "}
                      <span className="font-mono">#RRGGBB</span>.
                    </TooltipContent>
                  </Tooltip>
                  <div className="flex flex-col gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor={`sh-lane-hex-${i}`} className="text-xs cursor-help">
                          Hex
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-pretty">
                        Paste or type a six-digit hex color. Invalid values fall back to defaults on save validation.
                      </TooltipContent>
                    </Tooltip>
                    <Input
                      id={`sh-lane-hex-${i}`}
                      value={lane.color}
                      onChange={(e) => updateLane(i, { color: normalizeHexInput(e.target.value) })}
                      className="h-9 w-[7.5rem] font-mono text-xs uppercase"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 rounded-lg border border-dashed border-muted-foreground/40 p-4">
          <h3 className="text-sm font-semibold">Unlinked (private group)</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs cursor-help">System picker</Label>
                  <input
                    type="color"
                    aria-label="Unlinked accent — system color dialog"
                    title="Neutral accent for widgets not on a link lane."
                    value={isValidHex6(draft.unlinkedColor) ? draft.unlinkedColor : "#64748b"}
                    onChange={(e) => setUnlinked(e.target.value.toUpperCase())}
                    className="h-10 w-14 cursor-pointer overflow-hidden rounded-md border border-input bg-background p-0"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-pretty">
                Used when a tile is &quot;Unlinked&quot; — muted header/chrome instead of a bright lane stripe. Same
                system color dialog as link lanes.
              </TooltipContent>
            </Tooltip>
            <div className="flex flex-col gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Label htmlFor="sh-unlinked-hex" className="text-xs cursor-help">
                    Hex
                  </Label>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-pretty">
                  Six-digit hex only. This should stay relatively neutral for readable header text.
                </TooltipContent>
              </Tooltip>
              <Input
                id="sh-unlinked-hex"
                value={draft.unlinkedColor}
                onChange={(e) => setUnlinked(normalizeHexInput(e.target.value))}
                className="h-9 w-[7.5rem] font-mono text-xs uppercase"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={() => canSave && saveMutation.mutate(draft)}
                disabled={!canSave || saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save workspace colors"
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-pretty">
              Writes globally to the database. All logged-in users pick this up when the workspace palette query
              refetches (navigation, refresh, or within about a minute).
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" onClick={resetDraftToDefaults} disabled={saveMutation.isPending}>
                Reset form to shipped defaults
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-pretty">
              Fills the form with the built-in Emerald/Sky/… preset. Does not save until you click Save.
            </TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}
