import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IndicatorsFourSquaresIcon } from "@/components/chart/ChartToolbarIcons";
import type { StartHereInterval } from "@/components/MiniChart";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

/** Standard mini-chart timeframes (no 15m). */
export const MINI_CHART_CONTROL_INTERVALS = ["5m", "30m", "1d"] as const satisfies readonly StartHereInterval[];

export type MiniChartControlInterval = (typeof MINI_CHART_CONTROL_INTERVALS)[number];

export function normalizeMiniChartControlInterval(
  interval: StartHereInterval
): MiniChartControlInterval {
  if (interval === "15m") return "30m";
  if (interval === "5m" || interval === "30m" || interval === "1d") return interval;
  return "1d";
}

function isMiniChartControlInterval(v: string): v is MiniChartControlInterval {
  return v === "1d" || v === "5m" || v === "30m";
}

export interface MiniChartControlBarProps {
  interval: StartHereInterval;
  onIntervalChange: (interval: MiniChartControlInterval) => void;
  onOpenMaSettings: () => void;
  className?: string;
  showTimeframes?: boolean;
  starred?: boolean;
  onToggleStar?: () => void;
  starSymbol?: string;
}

/** Timeframe toggles (5 / 30 / D) + mini-chart indicator settings. */
export function MiniChartControlBar({
  interval,
  onIntervalChange,
  onOpenMaSettings,
  className,
  showTimeframes = true,
  starred = false,
  onToggleStar,
  starSymbol,
}: MiniChartControlBarProps) {
  const active = normalizeMiniChartControlInterval(interval);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-slate-700/50 bg-slate-900/80 px-2 py-1 shrink-0",
        className
      )}
    >
      {showTimeframes ? (
        <ToggleGroup
          type="single"
          value={active}
          onValueChange={(v) => {
            if (isMiniChartControlInterval(v)) onIntervalChange(v);
          }}
          variant="outline"
          size="sm"
          className="h-7"
        >
          <ToggleGroupItem value="5m" aria-label="5 minute bars" className="h-6 px-2.5 text-[11px]">
            5
          </ToggleGroupItem>
          <ToggleGroupItem value="30m" aria-label="30 minute bars" className="h-6 px-2.5 text-[11px]">
            30
          </ToggleGroupItem>
          <ToggleGroupItem value="1d" aria-label="Daily bars" className="h-6 px-2.5 text-[11px]">
            D
          </ToggleGroupItem>
        </ToggleGroup>
      ) : (
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Chart</span>
      )}

      <div className="flex items-center gap-0.5">
        {onToggleStar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0",
                  starred ? "text-amber-400 hover:text-amber-300" : "text-slate-300 hover:text-white"
                )}
                onClick={onToggleStar}
                data-testid={
                  starSymbol ? `button-ticker-review-star-${starSymbol}` : "button-mini-chart-star"
                }
                aria-label={
                  starSymbol
                    ? starred
                      ? `Unstar ${starSymbol}`
                      : `Star ${starSymbol}`
                    : starred
                      ? "Unstar"
                      : "Star"
                }
              >
                <Star className={cn("h-3.5 w-3.5", starred && "fill-amber-400")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {starred ? "Remove from saved charts" : "Save to daily watchlist"}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-300 hover:text-white"
              onClick={onOpenMaSettings}
              data-testid="button-mini-chart-ma-settings"
            >
              <IndicatorsFourSquaresIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Mini chart indicator settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
