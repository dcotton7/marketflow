import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Database } from "lucide-react";
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
  MaDataLimitsPanel,
  type MaSettingRow,
  type MaGridLimits,
} from "@/components/MaSettingsGridPanel";

interface ChartPrefs extends ChartMaDataLimits {
  defaultBarsOnScreen: number;
  themeMembersMa1?: string;
  themeMembersMa2?: string;
  chartBackgroundColor?: string | null;
}

const DEFAULT_LIMITS: MaGridLimits = {
  defaultBarsOnScreen: 200,
  ...DEFAULT_CHART_MA_LIMITS,
};

/** Main trade chart indicator + chart appearance settings (not Start Here mini charts). */
export function MaSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeTab, setActiveTab] = useState("indicators");
  const [rows, setRows] = useState<MaSettingRow[]>([]);
  const [defaultBars, setDefaultBars] = useState(200);
  const [limits, setLimits] = useState<MaGridLimits>(DEFAULT_LIMITS);
  const [showDataLimits, setShowDataLimits] = useState(false);
  const [chartBackgroundColor, setChartBackgroundColor] = useState<string>(DEFAULT_CHART_BACKGROUND_COLOR);

  const { data, isLoading } = useQuery<MaSettingRow[]>({
    queryKey: ["/api/sentinel/ma-settings"],
    enabled: open,
  });

  const { data: chartPrefs } = useQuery<ChartPrefs>({
    queryKey: ["/api/sentinel/chart-preferences"],
    enabled: open,
  });

  useEffect(() => {
    if (data) setRows(data);
  }, [data]);

  useEffect(() => {
    if (chartPrefs) {
      setDefaultBars(chartPrefs.defaultBarsOnScreen);
      setLimits({
        defaultBarsOnScreen: chartPrefs.defaultBarsOnScreen,
        dataLimitDaily: chartPrefs.dataLimitDaily ?? 750,
        dataLimit5min: chartPrefs.dataLimit5min ?? 63,
        dataLimit15min: chartPrefs.dataLimit15min ?? 126,
        dataLimit30min: chartPrefs.dataLimit30min ?? 126,
      });
      const bg = chartPrefs.chartBackgroundColor?.trim();
      setChartBackgroundColor(
        bg && isValidChartBackgroundColor(bg) ? bg : DEFAULT_CHART_BACKGROUND_COLOR
      );
    }
  }, [chartPrefs]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const defaultBarsRef = useRef(defaultBars);
  defaultBarsRef.current = defaultBars;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const chartBgRef = useRef(chartBackgroundColor);
  chartBgRef.current = chartBackgroundColor;

  const saveIndicatorMutation = useMutation({
    mutationFn: async (currentRows: MaSettingRow[]) => {
      await apiRequest("PUT", "/api/sentinel/ma-settings", { rows: currentRows });
      const cachedPrefs = queryClient.getQueryData<ChartPrefs>(["/api/sentinel/chart-preferences"]);
      await apiRequest("PUT", "/api/sentinel/chart-preferences", {
        defaultBarsOnScreen: defaultBarsRef.current,
        dataLimitDaily: limitsRef.current.dataLimitDaily,
        dataLimit5min: limitsRef.current.dataLimit5min,
        dataLimit15min: limitsRef.current.dataLimit15min,
        dataLimit30min: limitsRef.current.dataLimit30min,
        themeMembersMa1: cachedPrefs?.themeMembersMa1,
        themeMembersMa2: cachedPrefs?.themeMembersMa2,
        chartBackgroundColor: cachedPrefs?.chartBackgroundColor ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/ma-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/chart-preferences"] });
      onOpenChange(false);
    },
  });

  const saveChartSettingsMutation = useMutation({
    mutationFn: async () => {
      const cachedPrefs = queryClient.getQueryData<ChartPrefs>(["/api/sentinel/chart-preferences"]);
      const bg = chartBgRef.current.trim();
      await apiRequest("PUT", "/api/sentinel/chart-preferences", {
        defaultBarsOnScreen: cachedPrefs?.defaultBarsOnScreen ?? defaultBarsRef.current,
        dataLimitDaily: cachedPrefs?.dataLimitDaily ?? limitsRef.current.dataLimitDaily,
        dataLimit5min: cachedPrefs?.dataLimit5min ?? limitsRef.current.dataLimit5min,
        dataLimit15min: cachedPrefs?.dataLimit15min ?? limitsRef.current.dataLimit15min,
        dataLimit30min: cachedPrefs?.dataLimit30min ?? limitsRef.current.dataLimit30min,
        themeMembersMa1: cachedPrefs?.themeMembersMa1,
        themeMembersMa2: cachedPrefs?.themeMembersMa2,
        chartBackgroundColor: isValidChartBackgroundColor(bg) ? bg : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/chart-preferences"] });
      onOpenChange(false);
    },
  });

  const resetChartBg = () => setChartBackgroundColor(DEFAULT_CHART_BACKGROUND_COLOR);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-w-5xl max-h-[80vh] overflow-y-auto"
        data-testid="dialog-ma-settings"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle data-testid="title-ma-settings">Chart &amp; Indicator Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="indicators" data-testid="tab-indicator-settings">
              Indicator Settings
            </TabsTrigger>
            <TabsTrigger value="chart" data-testid="tab-chart-settings">
              Chart Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="indicators" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                <MaSettingsGridPanel rows={rows} limits={limits} onRowsChange={setRows} idPrefix="ma" />

                {showDataLimits && (
                  <MaDataLimitsPanel limits={limits} onLimitsChange={setLimits} />
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDataLimits((prev) => !prev);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      data-testid="button-data-limits"
                      className={showDataLimits ? "toggle-elevate toggle-elevated" : ""}
                    >
                      <Database className="h-3.5 w-3.5 mr-1" />
                      Data Limits
                    </Button>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Label htmlFor="defaultBars" className="text-xs text-muted-foreground whitespace-nowrap">
                        Default Bars OnScreen
                      </Label>
                      <Input
                        id="defaultBars"
                        type="number"
                        value={defaultBars}
                        onChange={(e) =>
                          setDefaultBars(Math.max(50, Math.min(1000, parseInt(e.target.value) || 200)))
                        }
                        className="h-8 w-20 text-xs"
                        min={50}
                        max={1000}
                        step={10}
                        data-testid="input-default-bars"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveIndicatorMutation.mutate(rowsRef.current);
                    }}
                    disabled={saveIndicatorMutation.isPending}
                    data-testid="button-save-ma-settings"
                  >
                    {saveIndicatorMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="chart" className="mt-4 space-y-6">
            <section className="space-y-3" data-testid="chart-bg-section">
              <div>
                <h3 className="text-sm font-medium">Chart background</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Applies to main trading charts and Start Here mini charts. Mini chart indicators are edited from
                  Start Here → <span className="font-medium">Mini chart indicators</span>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="color"
                  value={chartBackgroundColor}
                  onChange={(e) => setChartBackgroundColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5"
                  data-testid="input-chart-bg-color"
                />
                <Input
                  value={chartBackgroundColor}
                  onChange={(e) => setChartBackgroundColor(e.target.value)}
                  className="h-9 w-28 text-xs font-mono"
                  placeholder={DEFAULT_CHART_BACKGROUND_COLOR}
                  data-testid="input-chart-bg-hex"
                />
                <Button size="sm" variant="outline" onClick={resetChartBg} data-testid="button-reset-chart-bg">
                  Reset to default
                </Button>
              </div>
            </section>

            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={() => saveChartSettingsMutation.mutate()}
                disabled={saveChartSettingsMutation.isPending}
                data-testid="button-save-chart-settings"
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
