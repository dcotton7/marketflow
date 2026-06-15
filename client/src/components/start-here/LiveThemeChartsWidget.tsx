import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Maximize2, Settings2 } from "lucide-react";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { StartHereInterval } from "@/components/MiniChart";
import { StartHereWidgetChrome } from "@/components/start-here/StartHereWidgetChrome";
import { StartHereGroupPicker, useStartHere, useStartHereGroup } from "@/components/start-here/StartHereContext";
import { LIVE_THEME_CHARTS_SURFACE, uiRegion } from "@shared/ui-surfaces";
import {
  DEFAULT_LIVE_THEME_CHARTS_CONFIG,
  LIVE_THEME_CHART_INTERVAL_OPTIONS,
  enabledLiveThemeChartColumns,
  normalizeLiveThemeChartsConfig,
} from "@/lib/live-theme-charts";
import { STOCK_HISTORY_INTRADAY_REFETCH_MS } from "@/hooks/use-stocks";
import { useLiveThemeChartsPopout } from "@/hooks/useLiveThemeChartsPopout";
import { LiveThemeChartsConfigDialog } from "@/components/start-here/LiveThemeChartsConfigDialog";
import { LiveThemeChartsContent } from "@/components/start-here/LiveThemeChartsContent";
import { ThemeChartSymbolViewer } from "@/components/start-here/ThemeChartSymbolViewer";

function isLiveThemeChartInterval(v: string): v is StartHereInterval {
  return (LIVE_THEME_CHART_INTERVAL_OPTIONS as readonly string[]).includes(v);
}

function formatChartIntervalLabel(interval: StartHereInterval): string {
  if (interval === "1d") return "Daily";
  return interval.replace("m", " min");
}

export function LiveThemeChartsWidget({
  cssVariables,
  instanceId,
  groupId: groupIdProp,
  accentColor: accentColorProp,
  onClose,
  mode = "embedded",
}: {
  cssVariables: CssVariables;
  instanceId: string;
  groupId: string;
  accentColor?: string;
  onClose: () => void;
  /** `window` = standalone browser pop-out; `embedded` = Start Here grid tile. */
  mode?: "embedded" | "window";
}) {
  const isWindowMode = mode === "window";
  const { dashboard, setLiveThemeChartsConfig, activeStartId } = useStartHere();
  const meta = dashboard.instances[instanceId];
  const resolvedGroupId =
    meta?.type === "themeCharts" ? meta.groupId : groupIdProp;
  const { accentLabel, accentColor: groupAccentColor } = useStartHereGroup(resolvedGroupId);
  const accentColor = accentColorProp ?? groupAccentColor;
  const { toast } = useToast();
  const { openLiveThemeChartsPopout, windowRef } = useLiveThemeChartsPopout();
  const [configOpen, setConfigOpen] = useState(false);
  const [externalPopoutOpen, setExternalPopoutOpen] = useState(false);
  const [chartsViewerSymbol, setChartsViewerSymbol] = useState<string | null>(null);

  const config = normalizeLiveThemeChartsConfig(
    meta?.type === "themeCharts"
      ? meta.liveThemeChartsConfig
      : DEFAULT_LIVE_THEME_CHARTS_CONFIG
  );
  const enabledColumns = enabledLiveThemeChartColumns(config);

  useEffect(() => {
    if (isWindowMode || !externalPopoutOpen) return;
    const timer = window.setInterval(() => {
      if (!windowRef.current || windowRef.current.closed) {
        setExternalPopoutOpen(false);
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [externalPopoutOpen, isWindowMode, windowRef]);

  const handlePopOut = () => {
    const opened = openLiveThemeChartsPopout({
      instanceId,
      startId: activeStartId,
    });
    if (opened) {
      setExternalPopoutOpen(true);
    } else {
      toast({
        title: "Popup blocked",
        description: "Allow popups for this site, then try Pop out again.",
        variant: "destructive",
      });
    }
  };

  const toolbarControls = (
    <div className="flex items-center gap-1">
      <ToggleGroup
        type="single"
        value={config.chartInterval}
        onValueChange={(v) => {
          if (isLiveThemeChartInterval(v)) {
            setLiveThemeChartsConfig(instanceId, { ...config, chartInterval: v });
          }
        }}
        variant="outline"
        size="sm"
        className="start-here-no-drag flex-shrink-0 justify-start"
        style={{ fontSize: cssVariables.fontSizeSmall }}
      >
        <ToggleGroupItem value="5m" aria-label="5 minute bars">
          5
        </ToggleGroupItem>
        <ToggleGroupItem value="15m" aria-label="15 minute bars">
          15
        </ToggleGroupItem>
        <ToggleGroupItem value="30m" aria-label="30 minute bars">
          30
        </ToggleGroupItem>
        <ToggleGroupItem value="1d" aria-label="Daily bars">
          D
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="start-here-no-drag h-8 px-2 text-xs"
        onClick={() => setConfigOpen(true)}
        data-testid="button-live-theme-charts-config"
      >
        <Settings2 className="mr-1 h-3.5 w-3.5" />
        Configure
      </Button>
      {!isWindowMode ? (
        <Link href="/sentinel/market-condition">
          <Button type="button" size="sm" variant="outline" className="start-here-no-drag h-8 px-2 text-xs">
            Open Flow
          </Button>
        </Link>
      ) : null}
      {!isWindowMode ? (
        <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
      ) : null}
    </div>
  );

  const headerExtra = (
    <div className="flex items-center gap-1">
      {toolbarControls}
      {!isWindowMode ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="start-here-no-drag h-8 px-2 text-xs"
              onClick={handlePopOut}
              data-testid="button-live-theme-charts-popout"
            >
              <Maximize2 className="mr-1 h-3.5 w-3.5" />
              Pop out
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Open in a separate window — drag it to another monitor
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );

  const body = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p
        className={cn(
          "text-muted-foreground px-0.5",
          isWindowMode ? "text-xs" : "text-[10px]"
        )}
      >
        {enabledColumns.length} column{enabledColumns.length === 1 ? "" : "s"} ·{" "}
        {formatChartIntervalLabel(config.chartInterval)} charts refresh ~every{" "}
        {STOCK_HISTORY_INTRADAY_REFETCH_MS / 1000}s · theme stats every 15m (rank vs prior 15m slot) · max 8 rows
        each
      </p>
      <LiveThemeChartsContent
        config={config}
        density={isWindowMode ? "popout" : "compact"}
        onOpenCharts={(symbol) => setChartsViewerSymbol(symbol.toUpperCase())}
      />
    </div>
  );

  const showPlaceholder = !isWindowMode && externalPopoutOpen;

  return (
    <>
      <div
        className="h-full min-h-0"
        data-ui-region={uiRegion(LIVE_THEME_CHARTS_SURFACE.id, isWindowMode ? "popoutSurface" : "widgetChrome")}
      >
        <StartHereWidgetChrome
          title="Live Theme Charts"
          cssVariables={cssVariables}
          onClose={onClose}
          headerExtra={headerExtra}
          accentColor={accentColor}
          accentLabel={accentLabel}
          frameClassName="h-full min-h-0"
        >
          {showPlaceholder ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
              <p>Viewing in a separate window.</p>
              <p className="text-[10px]">Close that window or click Pop out again to focus it.</p>
            </div>
          ) : (
            body
          )}
        </StartHereWidgetChrome>
      </div>

      <LiveThemeChartsConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        workspaceDefaultInterval={dashboard.defaultChartInterval}
        onSave={(next, options) => setLiveThemeChartsConfig(instanceId, next, options)}
      />

      <ThemeChartSymbolViewer
        symbol={chartsViewerSymbol}
        onClose={() => setChartsViewerSymbol(null)}
      />
    </>
  );
}
