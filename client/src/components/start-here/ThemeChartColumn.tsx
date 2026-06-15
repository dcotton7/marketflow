import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LIVE_THEME_CHARTS_COLUMN_LABELS,
  resolveThemesForColumn,
  snapshotKeyLabel,
  type LiveThemeChartsColumnKey,
  type LiveThemeChartsConfig,
} from "@/lib/live-theme-charts";
import type { ThemeRow } from "@/data/mockThemeData";
import { useThemeColumnMemberHighlights } from "@/hooks/use-live-theme-chart-data";
import { ThemeChartRow, type LiveThemeChartsDensity } from "@/components/start-here/ThemeChartRow";

export function ThemeChartColumn({
  columnKey,
  config,
  themes,
  comparisonTime,
  isLoading,
  error,
  density = "compact",
  onOpenCharts,
}: {
  columnKey: LiveThemeChartsColumnKey;
  config: LiveThemeChartsConfig;
  themes: ThemeRow[];
  comparisonTime?: string | null;
  isLoading: boolean;
  error: unknown;
  density?: LiveThemeChartsDensity;
  onOpenCharts?: (symbol: string) => void;
}) {
  const columnConfig = config[columnKey];
  const snapshotKey = columnConfig.snapshotKey;

  const columnThemes = useMemo(
    () => resolveThemesForColumn(columnKey, config, themes),
    [columnKey, config, themes]
  );

  const { highlightsByThemeId, accDistStatsByThemeId } = useThemeColumnMemberHighlights(
    columnThemes,
    snapshotKey,
    columnThemes.length > 0
  );

  const sliceLabel = snapshotKeyLabel(snapshotKey, undefined, comparisonTime);

  return (
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col rounded-md border border-border/50 bg-background/40",
        density === "popout" ? "min-w-[320px]" : "min-w-[220px]"
      )}
      data-testid={`theme-chart-column-${columnKey}`}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border/50 px-2 py-1.5">
        <h3 className={cn("font-semibold", density === "popout" ? "text-sm" : "text-xs")}>
          {LIVE_THEME_CHARTS_COLUMN_LABELS[columnKey]}
        </h3>
        <span className={cn("text-muted-foreground", density === "popout" ? "text-xs" : "text-[10px]")}>
          {sliceLabel}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {isLoading && !columnThemes.length ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-xs text-destructive">Could not load themes.</p>
        ) : columnThemes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No themes match this column.</p>
        ) : (
          columnThemes.map((theme) => (
            <ThemeChartRow
              key={`${columnKey}-${theme.id}`}
              columnKey={columnKey}
              theme={theme}
              snapshotKey={snapshotKey}
              chartInterval={config.chartInterval}
              highlights={highlightsByThemeId.get(theme.id) ?? []}
              accDistStats={accDistStatsByThemeId.get(theme.id) ?? null}
              density={density}
              onOpenCharts={onOpenCharts}
            />
          ))
        )}
      </div>
    </section>
  );
}
