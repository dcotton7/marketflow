import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MINI_MA_SETTINGS_QUERY_KEY,
  fetchMiniMaSettings,
  saveMiniMaSettings,
  copyMiniMaSettingsFromMain,
} from "@/lib/sentinel-ma-settings-api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_CHART_MA_LIMITS,
  type ChartMaDataLimits,
} from "@/lib/chart-ma-feasibility";
import {
  DEFAULT_CHART_BACKGROUND_COLOR,
  isValidChartBackgroundColor,
} from "@/lib/chart-preferences-shared";
import {
  MaSettingsGridPanel,
  type MaSettingRow,
  type MaGridLimits,
} from "@/components/MaSettingsGridPanel";

interface ChartPrefs extends ChartMaDataLimits {
  defaultBarsOnScreen?: number;
  themeMembersMa1?: string;
  themeMembersMa2?: string;
  chartBackgroundColor?: string | null;
}

interface MiniMaSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function preloadMiniRowsFromMain(mainRows: MaSettingRow[]): MaSettingRow[] {
  return mainRows.map((r) => ({
    ...r,
    thirtyMinOn: r.thirtyMinOn || r.fifteenMinOn,
  }));
}

export function MiniMaSettingsDialog({ open, onOpenChange }: MiniMaSettingsDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("indicators");
  const [rows, setRows] = useState<MaSettingRow[]>([]);
  const [limits, setLimits] = useState<MaGridLimits>({
    defaultBarsOnScreen: 200,
    ...DEFAULT_CHART_MA_LIMITS,
  });
  const [chartBackgroundColor, setChartBackgroundColor] = useState<string>(DEFAULT_CHART_BACKGROUND_COLOR);
  const autoCopiedRef = useRef(false);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const chartBgRef = useRef(chartBackgroundColor);
  chartBgRef.current = chartBackgroundColor;

  const { data: mainMaRows } = useQuery<MaSettingRow[]>({
    queryKey: ["/api/sentinel/ma-settings"],
    enabled: open,
  });

  const { data, isLoading, isError, error, refetch } = useQuery<MaSettingRow[]>({
    queryKey: MINI_MA_SETTINGS_QUERY_KEY,
    queryFn: fetchMiniMaSettings,
    enabled: open,
  });

  const { data: chartPrefs } = useQuery<ChartPrefs>({
    queryKey: ["/api/sentinel/chart-preferences"],
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      autoCopiedRef.current = false;
      return;
    }
    if (data?.length) {
      setRows(data);
      return;
    }
    if (mainMaRows?.length) {
      setRows(preloadMiniRowsFromMain(mainMaRows));
    }
  }, [open, data, mainMaRows]);

  useEffect(() => {
    if (chartPrefs) {
      setLimits({
        defaultBarsOnScreen: 200,
        dataLimitDaily: chartPrefs.dataLimitDaily ?? DEFAULT_CHART_MA_LIMITS.dataLimitDaily,
        dataLimit5min: chartPrefs.dataLimit5min ?? DEFAULT_CHART_MA_LIMITS.dataLimit5min,
        dataLimit15min: chartPrefs.dataLimit15min ?? DEFAULT_CHART_MA_LIMITS.dataLimit15min,
        dataLimit30min: chartPrefs.dataLimit30min ?? DEFAULT_CHART_MA_LIMITS.dataLimit30min,
      });
      const bg = chartPrefs.chartBackgroundColor?.trim();
      setChartBackgroundColor(
        bg && isValidChartBackgroundColor(bg) ? bg : DEFAULT_CHART_BACKGROUND_COLOR
      );
    }
  }, [chartPrefs]);

  const applyRows = (next: MaSettingRow[]) => {
    setRows(next);
    queryClient.setQueryData(MINI_MA_SETTINGS_QUERY_KEY, next);
  };

  const saveMutation = useMutation({
    mutationFn: saveMiniMaSettings,
    onSuccess: (saved) => {
      applyRows(saved);
      queryClient.invalidateQueries({ queryKey: MINI_MA_SETTINGS_QUERY_KEY });
      toast({ title: "Mini chart indicators saved" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not save mini chart indicators",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const saveChartSettingsMutation = useMutation({
    mutationFn: async () => {
      const cachedPrefs = queryClient.getQueryData<ChartPrefs>(["/api/sentinel/chart-preferences"]);
      const bg = chartBgRef.current.trim();
      await apiRequest("PUT", "/api/sentinel/chart-preferences", {
        defaultBarsOnScreen: cachedPrefs?.defaultBarsOnScreen ?? 200,
        dataLimitDaily: cachedPrefs?.dataLimitDaily ?? limits.dataLimitDaily,
        dataLimit5min: cachedPrefs?.dataLimit5min ?? limits.dataLimit5min,
        dataLimit15min: cachedPrefs?.dataLimit15min ?? limits.dataLimit15min,
        dataLimit30min: cachedPrefs?.dataLimit30min ?? limits.dataLimit30min,
        themeMembersMa1: cachedPrefs?.themeMembersMa1,
        themeMembersMa2: cachedPrefs?.themeMembersMa2,
        chartBackgroundColor: isValidChartBackgroundColor(bg) ? bg : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/chart-preferences"] });
      toast({ title: "Chart settings saved" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not save chart settings",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const copyFromMainMutation = useMutation({
    mutationFn: copyMiniMaSettingsFromMain,
    onSuccess: (copied) => {
      applyRows(copied);
      toast({
        title: "Copied from main chart",
        description: `${copied.length} indicator row${copied.length === 1 ? "" : "s"} loaded. Edit and save to keep changes.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Copy from main chart failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const copyMutateRef = useRef(copyFromMainMutation.mutate);
  copyMutateRef.current = copyFromMainMutation.mutate;

  useEffect(() => {
    if (!open || isLoading || isError || autoCopiedRef.current) return;
    if (data && data.length === 0) {
      autoCopiedRef.current = true;
      copyMutateRef.current();
    }
  }, [open, data, isLoading, isError]);

  const loading = isLoading || copyFromMainMutation.isPending;
  const resetChartBg = () => setChartBackgroundColor(DEFAULT_CHART_BACKGROUND_COLOR);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-w-5xl max-h-[80vh] overflow-y-auto"
        data-testid="dialog-mini-ma-settings"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle data-testid="title-mini-ma-settings">Mini Chart Settings</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          Start Here workspace mini charts. Main trade charts use{" "}
          <span className="font-medium">Indicator Settings</span> on the trade chart toolbar.
        </p>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="indicators" data-testid="tab-mini-indicator-settings">
              Indicators
            </TabsTrigger>
            <TabsTrigger value="chart" data-testid="tab-mini-chart-settings">
              Chart
            </TabsTrigger>
          </TabsList>

          <TabsContent value="indicators" className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 space-y-3">
                <p className="text-sm text-destructive">
                  Could not load mini chart settings{error instanceof Error ? `: ${error.message}` : "."}
                </p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {rows.length > 0
                      ? `${rows.length} row${rows.length === 1 ? "" : "s"} · Daily · 5m · 15m · 30m`
                      : "No rows loaded yet."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyFromMainMutation.mutate()}
                    disabled={copyFromMainMutation.isPending}
                    data-testid="button-copy-mini-from-main"
                  >
                    {copyFromMainMutation.isPending && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    )}
                    Copy from main chart
                  </Button>
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No indicator rows yet. Click <span className="font-medium">Copy from main chart</span> to load your
                    main chart grid, then customize for mini charts.
                  </div>
                ) : (
                  <MaSettingsGridPanel
                    rows={rows}
                    limits={limits}
                    onRowsChange={setRows}
                    idPrefix="mini"
                    showThirtyMin
                  />
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate(rowsRef.current)}
                    disabled={saveMutation.isPending || rows.length === 0}
                    data-testid="button-save-mini-ma-settings"
                  >
                    {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    Save indicators
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="chart" className="mt-4 space-y-6">
            <section className="space-y-3" data-testid="mini-chart-bg-section">
              <div>
                <h3 className="text-sm font-medium">Chart background</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Applies to Start Here mini charts and main trading charts.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="color"
                  value={chartBackgroundColor}
                  onChange={(e) => setChartBackgroundColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5"
                  data-testid="input-mini-chart-bg-color"
                />
                <Input
                  value={chartBackgroundColor}
                  onChange={(e) => setChartBackgroundColor(e.target.value)}
                  className="h-9 w-28 text-xs font-mono"
                  placeholder={DEFAULT_CHART_BACKGROUND_COLOR}
                  data-testid="input-mini-chart-bg-hex"
                />
                <Button size="sm" variant="outline" onClick={resetChartBg} data-testid="button-reset-mini-chart-bg">
                  Reset to default
                </Button>
              </div>
            </section>

            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => saveChartSettingsMutation.mutate()}
                disabled={saveChartSettingsMutation.isPending}
                data-testid="button-save-mini-chart-settings"
              >
                {saveChartSettingsMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                )}
                Save chart settings
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
