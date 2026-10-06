import { cn } from "@/lib/utils";
import { useSystemSettings } from "@/context/SystemSettingsContext";

export function ChartTickerChip({
  symbol,
  price,
  change,
  changePct,
  extendedLabel,
  extendedPct,
  loading = false,
  size = "chart",
  className,
  testIdPrefix = "text-chart",
}: {
  symbol: string;
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  extendedLabel?: string | null;
  extendedPct?: number | null;
  loading?: boolean;
  size?: "chart" | "compact";
  className?: string;
  testIdPrefix?: string;
}) {
  const { cssVariables } = useSystemSettings();
  const hasQuote = price != null && Number.isFinite(price);
  const hasChange = change != null && Number.isFinite(change);
  const hasPct = changePct != null && Number.isFinite(changePct);
  const up = (change ?? changePct ?? 0) >= 0;
  const text = size === "chart" ? "text-lg" : "text-[11px]";
  const pad = size === "chart" ? "gap-2 px-3 py-1" : "gap-1 px-1.5 py-0.5";
  const pipe = { color: cssVariables.textColorTiny };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-card",
        pad,
        className,
      )}
    >
      <span
        className={cn("font-mono font-bold", text)}
        style={{ color: cssVariables.textColorHeader }}
        data-testid={`${testIdPrefix}-symbol`}
      >
        {symbol || "—"}
      </span>
      {loading ? (
        <>
          <span style={pipe}>|</span>
          <span className={cn("font-mono text-muted-foreground animate-pulse", text)}>—</span>
        </>
      ) : hasQuote ? (
        <>
          <span style={pipe}>|</span>
          <span
            className={cn("font-mono font-semibold", text)}
            style={{ color: cssVariables.textColorHeader }}
            data-testid={`${testIdPrefix}-price`}
          >
            ${price!.toFixed(2)}
          </span>
          {hasChange ? (
            <>
              <span style={pipe}>|</span>
              <span
                className={cn("font-mono font-bold", text, up ? "text-rs-green" : "text-rs-red")}
                data-testid={`${testIdPrefix}-change`}
              >
                {up ? "+" : ""}
                {change!.toFixed(2)}
              </span>
            </>
          ) : null}
          {hasPct ? (
            <>
              <span style={pipe}>|</span>
              <span
                className={cn("font-mono font-bold", text, up ? "text-rs-green" : "text-rs-red")}
                data-testid={`${testIdPrefix}-pct`}
              >
                {up ? "+" : ""}
                {changePct!.toFixed(2)}%
              </span>
            </>
          ) : null}
          {extendedPct != null ? (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono font-semibold",
                size === "chart" ? "text-[10px]" : "text-[9px]",
                extendedPct >= 0 ? "border-emerald-500/40 text-rs-green" : "border-red-500/40 text-rs-red",
              )}
              title="Extended-hours change versus the regular-session close"
              data-testid={`${testIdPrefix}-extended-change`}
            >
              {extendedLabel ?? "EXT"} {extendedPct >= 0 ? "+" : ""}
              {extendedPct.toFixed(2)}%
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
