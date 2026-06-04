import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, Plus, Database } from "lucide-react";
import {
  calcBars,
  getMaxBarsForTimeframe,
  type ChartMaDataLimits,
  isMaRowFeasibleForTimeframe,
} from "@/lib/chart-ma-feasibility";

export interface MaSettingRow {
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

export interface MaGridLimits extends ChartMaDataLimits {
  defaultBarsOnScreen?: number;
}

export const LINE_TYPE_OPTIONS = [
  { value: "0", label: "Solid" },
  { value: "1", label: "Dashed" },
  { value: "2", label: "Dotted" },
  { value: "3", label: "LargeDashed" },
  { value: "4", label: "SparseDotted" },
];

export const MA_TYPE_OPTIONS = [
  { value: "sma", label: "SMA" },
  { value: "ema", label: "EMA" },
  { value: "vwap", label: "VWAP" },
];

function isNonVwap(row: MaSettingRow): boolean {
  return row.maType !== "vwap" && row.maType !== "vwap_hi" && row.maType !== "vwap_lo";
}

function isFeasible(row: MaSettingRow, timeframe: string, limits: MaGridLimits): boolean {
  return isMaRowFeasibleForTimeframe(row, timeframe, limits);
}

interface MaSettingsGridPanelProps {
  rows: MaSettingRow[];
  limits: MaGridLimits;
  onRowsChange: (rows: MaSettingRow[]) => void;
  idPrefix?: string;
  showThirtyMin?: boolean;
}

export function MaSettingsGridPanel({
  rows,
  limits,
  onRowsChange,
  idPrefix = "ma",
  showThirtyMin = true,
}: MaSettingsGridPanelProps) {
  const updateRow = (rowId: string, field: keyof MaSettingRow, value: unknown) => {
    onRowsChange(
      rows.map((r) => {
        if (r.rowId !== rowId) return r;
        if (field === "maType" && value === "vwap") {
          return { ...r, [field]: value, period: null };
        }
        return { ...r, [field]: value };
      })
    );
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
    onRowsChange([...rows, newRow]);
  };

  const deleteRow = (rowId: string) => {
    onRowsChange(rows.filter((r) => r.rowId !== rowId));
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
    const requiredBars =
      isNonVwap(row) && row.period != null
        ? row.calcOn === "intraday"
          ? row.period
          : (calcBars(row.period, timeframe) ?? row.period)
        : null;
    const maxBars = Math.round(getMaxBarsForTimeframe(timeframe, limits));

    const switchEl = (
      <div className="flex flex-col items-center gap-0.5">
        <Switch
          checked={checked && feasible}
          onCheckedChange={(v) => updateRow(row.rowId, field, v)}
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
      const tfLabel =
        timeframe === "5m" || timeframe === "5min"
          ? "5min"
          : timeframe === "15m" || timeframe === "15min"
            ? "15min"
            : timeframe === "30m" || timeframe === "30min"
              ? "30min"
              : "daily";
      const limitDays =
        tfLabel === "5min"
          ? limits.dataLimit5min
          : tfLabel === "15min"
            ? limits.dataLimit15min
            : tfLabel === "30min"
              ? limits.dataLimit30min
              : limits.dataLimitDaily;
      return (
        <Tooltip>
          <TooltipTrigger asChild>{switchEl}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Needs {requiredBars.toLocaleString()} bars but only {maxBars.toLocaleString()} available ({limitDays}d
            lookback). Update Data Limits to enable.
          </TooltipContent>
        </Tooltip>
      );
    }

    return switchEl;
  };

  return (
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
              {showThirtyMin ? <th className="text-center py-2 px-1 font-medium">30m</th> : null}
              <th className="py-2 px-1 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.rowId}
                className={`border-b ${row.isSystem ? "bg-muted/30" : ""}`}
                data-testid={`row-${idPrefix}-setting-${index}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <td className="py-1.5 px-1">
                  {row.isSystem ? (
                    <span className="text-sm text-muted-foreground" data-testid={`text-${idPrefix}-title-${index}`}>
                      {row.title}
                    </span>
                  ) : (
                    <Input
                      value={row.title}
                      onChange={(e) => updateRow(row.rowId, "title", e.target.value)}
                      className="h-7 text-xs w-28"
                      data-testid={`input-${idPrefix}-title-${index}`}
                    />
                  )}
                </td>
                <td className="py-1.5 px-1">
                  {row.isSystem ? (
                    <span className="text-sm text-muted-foreground" data-testid={`text-${idPrefix}-type-${index}`}>
                      {row.maType.toUpperCase()}
                    </span>
                  ) : (
                    <Select value={row.maType} onValueChange={(v) => updateRow(row.rowId, "maType", v)}>
                      <SelectTrigger className="h-7 text-xs w-20" data-testid={`select-${idPrefix}-type-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MA_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="py-1.5 px-1">
                  {row.isSystem || row.maType === "vwap" ? (
                    <span className="text-sm text-muted-foreground" data-testid={`text-${idPrefix}-period-${index}`}>
                      {row.maType === "vwap" ? "Auto" : row.period}
                    </span>
                  ) : (
                    <Input
                      type="number"
                      value={row.period ?? ""}
                      onChange={(e) =>
                        updateRow(row.rowId, "period", e.target.value ? parseInt(e.target.value) : null)
                      }
                      className="h-7 text-xs w-16"
                      data-testid={`input-${idPrefix}-period-${index}`}
                    />
                  )}
                </td>
                <td className="py-1.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                  {row.maType === "vwap" || row.maType === "vwap_hi" || row.maType === "vwap_lo" ? (
                    <span className="text-[10px] text-muted-foreground">-</span>
                  ) : (
                    <Select value={row.calcOn || "daily"} onValueChange={(v) => updateRow(row.rowId, "calcOn", v)}>
                      <SelectTrigger className="h-7 text-xs w-20" data-testid={`select-${idPrefix}-calcon-${index}`}>
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
                    onChange={(e) => updateRow(row.rowId, "color", e.target.value)}
                    className="h-7 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
                    data-testid={`input-${idPrefix}-color-${index}`}
                  />
                </td>
                <td className="py-1.5 px-1">
                  <Select
                    value={String(row.lineType)}
                    onValueChange={(v) => updateRow(row.rowId, "lineType", parseInt(v))}
                  >
                    <SelectTrigger className="h-7 text-xs w-28" data-testid={`select-${idPrefix}-linetype-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LINE_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-1.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                  {renderSwitch(row, index, "dailyOn", "daily", `${idPrefix}-daily`)}
                </td>
                <td className="py-1.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                  {renderSwitch(row, index, "fiveMinOn", "5m", `${idPrefix}-5m`)}
                </td>
                <td className="py-1.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                  {renderSwitch(row, index, "fifteenMinOn", "15m", `${idPrefix}-15m`)}
                </td>
                {showThirtyMin ? (
                  <td className="py-1.5 px-1 text-center" onClick={(e) => e.stopPropagation()}>
                    {renderSwitch(row, index, "thirtyMinOn", "30m", `${idPrefix}-30m`)}
                  </td>
                ) : null}
                <td className="py-1.5 px-1">
                  {!row.isSystem && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteRow(row.rowId)}
                      data-testid={`button-${idPrefix}-delete-${index}`}
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
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          addRow();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid={`button-${idPrefix}-add-row`}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Row
      </Button>
    </div>
  );
}

interface DataLimitsPanelProps {
  limits: MaGridLimits;
  onLimitsChange: (limits: MaGridLimits) => void;
}

export function MaDataLimitsPanel({ limits, onLimitsChange }: DataLimitsPanelProps) {
  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/20" data-testid="data-limits-panel">
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Data Provider Limits (days of history)</span>
      </div>
      <p className="text-[10px] text-muted-foreground/70 leading-tight">
        These limits reflect how many days of historical data your data provider can deliver per timeframe. MAs that
        require more bars than available will be greyed out.
      </p>
      <div className="grid grid-cols-4 gap-3 pt-1" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Daily</Label>
          <Input
            type="number"
            value={limits.dataLimitDaily}
            onChange={(e) =>
              onLimitsChange({ ...limits, dataLimitDaily: Math.max(30, parseInt(e.target.value) || 750) })
            }
            className="h-7 text-xs"
            data-testid="input-limit-daily"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">5min</Label>
          <Input
            type="number"
            value={limits.dataLimit5min}
            onChange={(e) =>
              onLimitsChange({ ...limits, dataLimit5min: Math.max(1, parseInt(e.target.value) || 63) })
            }
            className="h-7 text-xs"
            data-testid="input-limit-5m"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">15min</Label>
          <Input
            type="number"
            value={limits.dataLimit15min}
            onChange={(e) =>
              onLimitsChange({ ...limits, dataLimit15min: Math.max(1, parseInt(e.target.value) || 126) })
            }
            className="h-7 text-xs"
            data-testid="input-limit-15m"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">30min</Label>
          <Input
            type="number"
            value={limits.dataLimit30min}
            onChange={(e) =>
              onLimitsChange({ ...limits, dataLimit30min: Math.max(1, parseInt(e.target.value) || 126) })
            }
            className="h-7 text-xs"
            data-testid="input-limit-30m"
          />
        </div>
      </div>
    </div>
  );
}
