import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { BARS_PER_DAY } from "@shared/indicatorTemplates";

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

function calcBars(dayPeriod: number | null, timeframe: string): number | null {
  if (dayPeriod == null) return null;
  const bpd = BARS_PER_DAY[timeframe];
  if (bpd == null || bpd <= 0) return dayPeriod;
  return Math.max(1, Math.round(dayPeriod * bpd));
}

function isNonVwap(row: MaSettingRow): boolean {
  return row.maType !== "vwap" && row.maType !== "vwap_hi" && row.maType !== "vwap_lo";
}

export function MaSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rows, setRows] = useState<MaSettingRow[]>([]);
  const [defaultBars, setDefaultBars] = useState(200);

  const { data, isLoading } = useQuery<MaSettingRow[]>({
    queryKey: ["/api/sentinel/ma-settings"],
    enabled: open,
  });

  const { data: chartPrefs } = useQuery<{ defaultBarsOnScreen: number }>({
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
    }
  }, [chartPrefs]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const defaultBarsRef = useRef(defaultBars);
  defaultBarsRef.current = defaultBars;

  const saveMutation = useMutation({
    mutationFn: async (currentRows: MaSettingRow[]) => {
      await apiRequest("PUT", "/api/sentinel/ma-settings", { rows: currentRows });
      await apiRequest("PUT", "/api/sentinel/chart-preferences", { defaultBarsOnScreen: defaultBarsRef.current });
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
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            checked={row.dailyOn}
                            onCheckedChange={v => updateRow(row.rowId, "dailyOn", v)}
                            className="scale-75"
                            data-testid={`switch-daily-${index}`}
                          />
                          {isNonVwap(row) && row.period != null && (
                            <span className="text-[9px] text-muted-foreground leading-none" data-testid={`bars-daily-${index}`}>
                              {row.period}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            checked={row.fiveMinOn}
                            onCheckedChange={v => updateRow(row.rowId, "fiveMinOn", v)}
                            className="scale-75"
                            data-testid={`switch-5m-${index}`}
                          />
                          {isNonVwap(row) && row.period != null && (
                            row.calcOn === "daily" ? (
                              <span className="text-[9px] text-muted-foreground leading-none" data-testid={`bars-5m-${index}`}>
                                {calcBars(row.period, "5m")}
                              </span>
                            ) : (
                              <span className="text-[9px] text-muted-foreground/40 leading-none" data-testid={`bars-5m-${index}`}>
                                {row.period}
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            checked={row.fifteenMinOn}
                            onCheckedChange={v => updateRow(row.rowId, "fifteenMinOn", v)}
                            className="scale-75"
                            data-testid={`switch-15m-${index}`}
                          />
                          {isNonVwap(row) && row.period != null && (
                            row.calcOn === "daily" ? (
                              <span className="text-[9px] text-muted-foreground leading-none" data-testid={`bars-15m-${index}`}>
                                {calcBars(row.period, "15m")}
                              </span>
                            ) : (
                              <span className="text-[9px] text-muted-foreground/40 leading-none" data-testid={`bars-15m-${index}`}>
                                {row.period}
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 px-1 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            checked={row.thirtyMinOn}
                            onCheckedChange={v => updateRow(row.rowId, "thirtyMinOn", v)}
                            className="scale-75"
                            data-testid={`switch-30m-${index}`}
                          />
                          {isNonVwap(row) && row.period != null && (
                            row.calcOn === "daily" ? (
                              <span className="text-[9px] text-muted-foreground leading-none" data-testid={`bars-30m-${index}`}>
                                {calcBars(row.period, "30m")}
                              </span>
                            ) : (
                              <span className="text-[9px] text-muted-foreground/40 leading-none" data-testid={`bars-30m-${index}`}>
                                {row.period}
                              </span>
                            )
                          )}
                        </div>
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

            <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); addRow(); }} onPointerDown={e => e.stopPropagation()} data-testid="button-add-row">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Row
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
