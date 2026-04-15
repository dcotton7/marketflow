import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, Plus, Loader2, Database } from "lucide-react";
import {
  calcBars,
  getMaxBarsForTimeframe,
  DEFAULT_CHART_MA_LIMITS,
  type ChartMaDataLimits,
  isMaRowFeasibleForTimeframe,
} from "@/lib/chart-ma-feasibility";

interface MaSettingRow {
  id?: number;
  rowId: string;
  title: string;
  maType: string;
  period: number | null;
  color: string;
  lineType: number;
  isSystem: boolean;
  isVisible: boolean;
  dailyOn: boolean;
  fiveMinOn: boolean;
  fifteenMinOn: boolean;
  thirtyMinOn: boolean;
  sortOrder: number;
  calcOn: "daily" | "intraday";
}

interface ChartPrefs extends ChartMaDataLimits {
  defaultBarsOnScreen: number;
}

const LINE_TYPE_OPTIONS = [
  { value: "0", label: "Solid" },
  { value: "1", label: "Dashed" },
  { value: "2", label: "Dotted" },
  { value: "3", label: "LargeDashed" },
  { value: "4", label: "SparseDotted" },
];

const MA_TYPE_OPTIONS = [
  { value: "sma", label: "SMA" },
  { value: "ema", label: "EMA" },
  { value: "vwap", label: "VWAP" },
];

function isNonVwap(row: MaSettingRow): boolean {
  return row.maType !== "vwap" && row.maType !== "vwap_hi" && row.maType !== "vwap_lo";
}

function isFeasible(row: MaSettingRow, timeframe: string, limits: ChartPrefs): boolean {
  return isMaRowFeasibleForTimeframe(row, timeframe, limits);
}

const DEFAULT_LIMITS: ChartPrefs = {
  defaultBarsOnScreen: 200,
  ...DEFAULT_CHART_MA_LIMITS,
};

export function MaSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rows, setRows] = useState<MaSettingRow[]>([]);
  const [defaultBars, setDefaultBars] = useState(200);
  const [limits, setLimits] = useState<ChartPrefs>(DEFAULT_LIMITS);
  const [showDataLimits, setShowDataLimits] = useState(false);

  const { data, isLoading } = useQuery<MaSettingRow[]>({
    queryKey: ["/api/sentinel/ma-settings"],
    enabled: open,
  });

  const { data: chartPrefs } = useQuery<ChartPrefs>({
    queryKey: ["/api/sentinel/chart-preferences"],
    enabled: open,
  });

  useEffect(() => {
    if (data) {
      setRows(data);
    }
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
    }
  }, [chartPrefs]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const defaultBarsRef = useRef(defaultBars);
  defaultBarsRef.current = defaultBars;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const saveMutation = useMutation({
    mutationFn: async (currentRows: MaSettingRow[]) => {
      await apiRequest("PUT", "/api/sentinel/ma-settings", { rows: currentRows });
      await apiRequest("PUT", "/api/sentinel/chart-preferences", {
        defaultBarsOnScreen: defaultBarsRef.current,
        dataLimitDaily: limitsRef.current.dataLimitDaily,
        dataLimit5min: limitsRef.current.dataLimit5min,
        dataLimit15min: limitsRef.current.dataLimit15min,
        dataLimit30min: limitsRef.current.dataLimit30min,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/ma-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/chart-preferences"] });
      onOpenChange(false);
    },
  });

  const updateRow = (rowId: string, field: keyof MaSettingRow, value: unknown) => {
    setRows(prev => prev.map(r => {
      if (r.rowId !== rowId) return r;
      if (field === "maType" && value === "vwap") {
        return { ...r, [field]: value, period: null };
      }
      return { ...r, [field]: value };
    }));
  };

  const addRow = () => {
    const newRow: MaSettingRow = {
      rowId: `custom-${Date.now()}`,
      title: "Custom MA",
      maType: "sma",
      period: 10,
      color: "#ffffff",
      lineType: 0,
      isSystem: false,
      isVisible: true,
      dailyOn: true,
      fiveMinOn: true,
      fifteenMinOn: true,
      thirtyMinOn: true,
      sortOrder: rows.length,
      calcOn: "daily",
    };
    setRows(prev => [...prev, newRow]);
  };

  const deleteRow = (rowId: string) => {
    setRows(prev => prev.filter(r => r.rowId !== rowId));
  };

  const renderSwitch = (
    row: MaSettingRow,
    index: number,
    field: "dailyOn" | "fiveMinOn" | "fifteenMinOn" | "thirtyMinOn",
    timeframe: string,
    testIdPrefix: string
  ) => {
    const feasible = isFeasible(row, timeframe, limits);
    const checked = row[field];
    const requiredBars = isNonVwap(row) && row.period != null
      ? (row.calcOn === "intraday" ? row.period : calcBars(row.period, timeframe) ?? row.period)
      : null;
    const maxBars = Math.round(getMaxBarsForTimeframe(timeframe, limits));

    const switchEl = (
      <div className="flex flex-col items-center gap-0.5">
        <Switch
          checked={checked && feasible}
          onCheckedChange={v => updateRow(row.rowId, field, v)}
          className={`scale-75 ${!feasible ? "opacity-30 pointer-events-none" : ""}`}
          disabled={!feasible}
          data-testid={`switch-${testIdPrefix}-${index}`}
        />
        {isNonVwap(row) && row.period != null && (
          <span
            className={`text-[9px] leading-none ${
              !feasible
                ? "text-destructive line-through"
                : row.calcOn === "daily"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/40"
            }`}
            data-testid={`bars-${testIdPrefix}-${index}`}
          >
            {row.calcOn === "daily" ? calcBars(row.period, timeframe) : row.period}
          </span>
        )}
      </div>
    );

    if (!feasible && requiredBars != null) {
      const tfLabel = timeframe === "5m" || timeframe === "5min" ? "5min"
        : timeframe === "15m" || timeframe === "15min" ? "15min"
        : timeframe === "30m" || timeframe === "30min" ? "30min" : "daily";
      const limitDays = tfLabel === "5min" ? limits.dataLimit5min
        : tfLabel === "15min" ? limits.dataLimit15min
        : tfLabel === "30min" ? limits.dataLimit30min
        : limits.dataLimitDaily;
      return (
        <Tooltip>
          <TooltipTrigger asChild>{switchEl}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Needs {requiredBars.toLocaleString()} bars but only {maxBars.toLocaleString()} available ({limitDays}d lookback). Update Data Limits to enable.
          </TooltipContent>
        </Tooltip>
      );
    }

    return switchEl;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-w-5xl max-h-[80vh] overflow-y-auto"
        data-testid="dialog-ma-settings"
        onCloseAutoFocus={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle data-testid="title-ma-settings">Indicator Settings</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-1 font-medium">Title</th>
                    <th className="text-left py-2 px-1 font-medium">Type</th>
                    <th className="text-left py-2 px-1 font-medium">Period</th>
                    <th className="text-center py-2 px-1 font-medium">Calc On</th>
                    <th className="text-left py-2 px-1 font-medium">Color</th>
                    <th className="text-left py-2 px-1 font-medium">Line Type</th>
                    <th className="text-center py-2 px-1 font-medium">Daily</th>
                    <th className="text-center py-2 px-1 font-medium">5m</th>
                    <th className="text-center py-2 px-1 font-medium">15m</th>
                    <th className="text-center py-2 px-1 font-medium">30m</th>
                    <th className="py-2 px-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={row.rowId}
                      className={`border-b ${row.isSystem ? "bg-muted/30" : ""}`}
                      data-testid={`row-ma-setting-${index}`}
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                    >
                      <td className="py-1.5 px-1">
                        <div className="flex items-center gap-1">
                          {row.isSystem ? (
                            <span className="text-sm text-muted-foreground" data-testid={`text-title-${index}`}>{row.title}</span>
                          ) : (
                            <Input
                              value={row.title}
                              onChange={e => updateRow(row.rowId, "title", e.target.value)}
                              className="h-7 text-xs w-28"
                              data-testid={`input-title-${index}`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-1">
                        {row.isSystem ? (
                          <span className="text-sm text-muted-foreground" data-testid={`text-type-${index}`}>{row.maType.toUpperCase()}</span>
                        ) : (
                          <Select value={row.maType} onValueChange={v => updateRow(row.rowId, "maType", v)}>
                            <SelectTrigger className="h-7 text-xs w-20" data-testid={`select-type-${index}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MA_TYPE_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 px-1">
                        {row.isSystem || row.maType === "vwap" ? (
                          <span className="text-sm text-muted-foreground" data-testid={`text-period-${index}`}>
                            {row.maType === "vwap" ? "Auto" : row.period}
                          </span>
                        ) : (
                          <Input
                            type="number"
                            value={row.period ?? ""}
                            onChange={e => updateRow(row.rowId, "period", e.target.value ? parseInt(e.target.value) : null)}
                            className="h-7 text-xs w-16"
                            data-testid={`input-period-${index}`}
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        {row.maType === "vwap" || row.maType === "vwap_hi" || row.maType === "vwap_lo" ? (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        ) : (
                          <Select value={row.calcOn || "daily"} onValueChange={v => updateRow(row.rowId, "calcOn", v)}>
                            <SelectTrigger className="h-7 text-xs w-20" data-testid={`select-calcon-${index}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="daily">Daily</SelectItem>
                              <SelectItem value="intraday">Intraday</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="py-1.5 px-1">
                        <input
                          type="color"
                          value={row.color}
                          onChange={e => updateRow(row.rowId, "color", e.target.value)}
                          className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
                          data-testid={`input-color-${index}`}
                        />
                      </td>
                      <td className="py-1.5 px-1">
                        <Select value={String(row.lineType)} onValueChange={v => updateRow(row.rowId, "lineType", parseInt(v))}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid={`select-linetype-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LINE_TYPE_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        {renderSwitch(row, index, "dailyOn", "daily", "daily")}
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        {renderSwitch(row, index, "fiveMinOn", "5m", "5m")}
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        {renderSwitch(row, index, "fifteenMinOn", "15m", "15m")}
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        {renderSwitch(row, index, "thirtyMinOn", "30m", "30m")}
                      </td>
                      <td className="py-1.5 px-1">
                        {!row.isSystem && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteRow(row.rowId)}
                            data-testid={`button-delete-${index}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showDataLimits && (
              <div className="border rounded-md p-3 space-y-2 bg-muted/20" data-testid="data-limits-panel">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Data Provider Limits (days of history)</span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 leading-tight">
                  These limits reflect how many days of historical data your data provider can deliver per timeframe.
                  MAs that require more bars than available will be greyed out. Update these values if you switch to a provider with more history.
                </p>
                <div className="grid grid-cols-4 gap-3 pt-1" onClick={e => e.stopPropagation()}>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Daily</Label>
                    <Input
                      type="number"
                      value={limits.dataLimitDaily}
                      onChange={e => setLimits(prev => ({ ...prev, dataLimitDaily: Math.max(30, parseInt(e.target.value) || 750) }))}
                      className="h-7 text-xs"
                      data-testid="input-limit-daily"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">5min</Label>
                    <Input
                      type="number"
                      value={limits.dataLimit5min}
                      onChange={e => setLimits(prev => ({ ...prev, dataLimit5min: Math.max(1, parseInt(e.target.value) || 63) }))}
                      className="h-7 text-xs"
                      data-testid="input-limit-5m"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">15min</Label>
                    <Input
                      type="number"
                      value={limits.dataLimit15min}
                      onChange={e => setLimits(prev => ({ ...prev, dataLimit15min: Math.max(1, parseInt(e.target.value) || 126) }))}
                      className="h-7 text-xs"
                      data-testid="input-limit-15m"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">30min</Label>
                    <Input
                      type="number"
                      value={limits.dataLimit30min}
                      onChange={e => setLimits(prev => ({ ...prev, dataLimit30min: Math.max(1, parseInt(e.target.value) || 126) }))}
                      className="h-7 text-xs"
                      data-testid="input-limit-30m"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); addRow(); }} onPointerDown={e => e.stopPropagation()} data-testid="button-add-row">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Row
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); setShowDataLimits(prev => !prev); }}
                  onPointerDown={e => e.stopPropagation()}
                  data-testid="button-data-limits"
                  className={showDataLimits ? "toggle-elevate toggle-elevated" : ""}
                >
                  <Database className="h-3.5 w-3.5 mr-1" />
                  Data Limits
                </Button>
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <Label htmlFor="defaultBars" className="text-xs text-muted-foreground whitespace-nowrap">Default Bars OnScreen</Label>
                  <Input
                    id="defaultBars"
                    type="number"
                    value={defaultBars}
                    onChange={e => setDefaultBars(Math.max(50, Math.min(1000, parseInt(e.target.value) || 200)))}
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
                onClick={(e) => { e.stopPropagation(); saveMutation.mutate(rowsRef.current); }}
                disabled={saveMutation.isPending}
                data-testid="button-save-ma-settings"
              >
                {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
