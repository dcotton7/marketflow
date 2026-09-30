import type { CssVariables } from "@/context/SystemSettingsContext";
import { StartHereWidgetChrome } from "./StartHereWidgetChrome";
import { useStartHereGroup } from "./StartHereContext";
import { MarketLeadersBoard } from "@/components/market-leaders/MarketLeadersBoard";

export function MarketLeadersWidget({
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
  return (
    <StartHereWidgetChrome
      title="Market Leaders"
      cssVariables={cssVariables}
      accentColor={accentColor}
      accentLabel={accentLabel}
      onClose={onClose}
    >
      <div className="start-here-no-drag min-h-0 flex-1 overflow-hidden" data-instance={instanceId}>
        <MarketLeadersBoard mode="widget" />
      </div>
    </StartHereWidgetChrome>
  );
}
