import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  enabledLiveThemeChartColumns,
  type LiveThemeChartsConfig,
} from "@/lib/live-theme-charts";
import { useLiveThemeChartsThemeData } from "@/hooks/use-live-theme-chart-data";
import { ThemeChartColumn } from "@/components/start-here/ThemeChartColumn";
import type { LiveThemeChartsDensity } from "@/components/start-here/ThemeChartRow";

export function LiveThemeChartsContent({
  config,
  density = "compact",
}: {
  config: LiveThemeChartsConfig;
  density?: LiveThemeChartsDensity;
}) {
  const enabledColumns = enabledLiveThemeChartColumns(config);
  const { themesBySnapshot, comparisonTimeBySnapshot, isLoading, error } =
    useLiveThemeChartsThemeData(config);

  const columnGridClass = useMemo(() => {
    const n = enabledColumns.length;
    if (n <= 1) return "grid-cols-1";
    if (n === 2) return "grid-cols-1 xl:grid-cols-2";
    return "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3";
  }, [enabledColumns.length]);

  if (enabledColumns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Enable at least one column in Configure.
      </div>
    );
  }

  return (
    <div className={cn("grid min-h-0 flex-1 gap-2", columnGridClass, density === "popout" && "gap-3")}>
      {enabledColumns.map((key) => (
        <ThemeChartColumn
          key={key}
          columnKey={key}
          config={config}
          themes={themesBySnapshot.get(config[key].snapshotKey) ?? []}
          comparisonTime={comparisonTimeBySnapshot.get(config[key].snapshotKey) ?? null}
          isLoading={isLoading}
          error={error}
          density={density}
        />
      ))}
    </div>
  );
}
