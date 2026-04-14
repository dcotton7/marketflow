import { Link } from "wouter";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { MarketFlowStripCompact } from "@/components/market-condition/MarketFlowStripCompact";
import { useMarketFlowStripData } from "@/hooks/useMarketFlowStripData";
import {
  paletteLaneHeaderControlClass,
  StartHereWidgetChrome,
} from "./StartHereWidgetChrome";
import { StartHereGroupPicker, useStartHere, useStartHereGroup } from "./StartHereContext";

export function StartHereFlowWidget({
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
  const { accentLabel } = useStartHereGroup(groupId);
  const { dashboard, setDefaultFlowTemplate, workspacePalette } = useStartHere();
  const isDefaultFlowTemplate = dashboard.defaultFlowInstanceId === instanceId;
  const { summary, themes, lastUpdated, marketSession, isLoading, hasLiveData, apiError } =
    useMarketFlowStripData();

  const paletteHdr = paletteLaneHeaderControlClass(accentColor, workspacePalette.unlinkedColor);

  const headerExtra = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          "start-here-no-drag h-8 flex-shrink-0 px-2 text-xs font-medium",
          paletteHdr,
          isDefaultFlowTemplate &&
            "bg-muted text-muted-foreground opacity-80 hover:bg-muted/90 hover:opacity-100"
        )}
        title="Resize, then Default — remembers this grid size for new Market Flow widgets (kept after you close this tile). Click Default again while highlighted to clear."
        aria-label={
          isDefaultFlowTemplate
            ? "Default Flow size is on — click to clear"
            : "Use this Market Flow tile’s size for new Flow widgets"
        }
        aria-pressed={isDefaultFlowTemplate}
        onClick={() => setDefaultFlowTemplate(isDefaultFlowTemplate ? null : instanceId)}
      >
        Default
      </Button>
      <Link href="/sentinel/market-condition">
        <Button type="button" size="sm" variant="outline" className="start-here-no-drag h-8 px-2 text-xs">
          Open Flow
        </Button>
      </Link>
      <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
    </div>
  );

  return (
    <StartHereWidgetChrome
      title="Market Flow"
      cssVariables={cssVariables}
      onClose={onClose}
      headerExtra={headerExtra}
      accentColor={accentColor}
      accentLabel={accentLabel}
      neutralAccentColor={workspacePalette.unlinkedColor}
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {isLoading && !hasLiveData ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {apiError && (
              <p className="text-xs text-amber-500/90">
                Live data unavailable — showing cached / demo values until the Flow API responds.
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              <MarketFlowStripCompact
                summary={summary}
                themes={themes}
                lastUpdated={lastUpdated}
                marketSession={marketSession}
              />
            </div>
          </>
        )}
      </div>
    </StartHereWidgetChrome>
  );
}
