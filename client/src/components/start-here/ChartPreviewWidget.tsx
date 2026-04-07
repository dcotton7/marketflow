import { Link } from "wouter";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MiniChart, type StartHereInterval } from "@/components/MiniChart";
import { BarChart3 } from "lucide-react";
import { StartHereWidgetChrome } from "./StartHereWidgetChrome";
import { StartHereGroupPicker, useStartHere, useStartHereGroup } from "./StartHereContext";

export function ChartPreviewWidget({
  cssVariables,
  instanceId,
  groupId,
  accentColor,
  onClose,
}: {
  cssVariables: CssVariables;
  instanceId: string;
  groupId: string;
  accentColor?: string;
  onClose: () => void;
}) {
  const { symbol, setSymbol, accentLabel } = useStartHereGroup(groupId);
  const { dashboard, setDefaultChartTemplate, setChartInterval } = useStartHere();
  const sym = symbol.trim().toUpperCase();
  const isDefaultTemplate = dashboard.defaultChartInstanceId === instanceId;
  const meta = dashboard.instances[instanceId];
  const chartTf: StartHereInterval =
    meta?.type === "chart" ? (meta.chartInterval ?? "1d") : "1d";

  const headerExtra = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={`start-here-no-drag h-8 flex-shrink-0 px-2 text-xs font-medium ${
          isDefaultTemplate
            ? "bg-muted text-muted-foreground opacity-80 hover:bg-muted/90 hover:opacity-100"
            : ""
        }`}
        title="Use this chart widget’s size and timeframe as the template for watchlist chart buttons and bulk load"
        aria-label={
          isDefaultTemplate
            ? "Default chart template is on — click to clear"
            : "Set as default chart template for watchlist"
        }
        aria-pressed={isDefaultTemplate}
        onClick={() => setDefaultChartTemplate(isDefaultTemplate ? null : instanceId)}
      >
        Default
      </Button>
      <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
    </div>
  );

  return (
    <StartHereWidgetChrome
      title="Chart preview"
      cssVariables={cssVariables}
      onClose={onClose}
      headerExtra={headerExtra}
      accentColor={accentColor}
      accentLabel={accentLabel}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Ticker"
            className="start-here-no-drag h-9 flex-1 font-mono uppercase"
            style={{ color: cssVariables.textColorNormal, fontSize: cssVariables.fontSizeSmall }}
          />
          <Link href={sym ? `/sentinel/charts?symbol=${encodeURIComponent(sym)}` : "/sentinel/charts"}>
            <Button type="button" size="sm" variant="outline" className="start-here-no-drag h-9 gap-1" disabled={!sym}>
              <BarChart3 className="h-4 w-4" />
              Charts
            </Button>
          </Link>
        </div>
        {!sym ? (
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
            Enter a symbol or pick one from a linked watchlist.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded border border-white/10 p-1">
            <ToggleGroup
              type="single"
              value={chartTf}
              onValueChange={(v) => {
                if (v === "5m" || v === "15m" || v === "1d") {
                  setChartInterval(instanceId, v);
                }
              }}
              variant="outline"
              size="sm"
              className="start-here-no-drag flex-shrink-0 justify-start px-1"
              style={{ fontSize: cssVariables.fontSizeSmall }}
            >
              <ToggleGroupItem value="5m" aria-label="5 minute bars">
                5m
              </ToggleGroupItem>
              <ToggleGroupItem value="15m" aria-label="15 minute bars">
                15m
              </ToggleGroupItem>
              <ToggleGroupItem value="1d" aria-label="Daily bars">
                Daily
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <MiniChart
                symbol={sym}
                timeframe="50D"
                movingAverages2150200
                startHereInterval={chartTf}
                fillContainer
              />
            </div>
          </div>
        )}
      </div>
    </StartHereWidgetChrome>
  );
}
