import { cn } from "@/lib/utils";
import {
  ema620GaugeTitle,
  formatEntryGauge,
  vwapGaugeTitle,
  type Ema620Cross,
  type EntryGaugeTone,
} from "@shared/entry-gauge";

export function entryGaugeClass(tone: EntryGaugeTone | null | undefined): string {
  if (tone === "entry") return "text-cyan-300 font-semibold";
  if (tone === "safe") return "text-green-600 font-medium";
  if (tone === "fail") return "text-red-400";
  return "text-slate-500";
}

export function EntryGaugeValue({
  kind,
  pct,
  tone,
  cross,
  className,
}: {
  kind: "vwap" | "ema620";
  pct: number | null | undefined;
  tone: EntryGaugeTone | null | undefined;
  cross?: Ema620Cross | null;
  className?: string;
}) {
  const title = kind === "vwap" ? vwapGaugeTitle(tone ?? null) : ema620GaugeTitle(tone ?? null, cross ?? null);
  return (
    <span className={cn("tabular-nums", entryGaugeClass(tone), className)} title={title}>
      {formatEntryGauge(pct, kind === "ema620" ? cross : null)}
    </span>
  );
}
