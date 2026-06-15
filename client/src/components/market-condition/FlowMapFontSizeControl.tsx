import { cn } from "@/lib/utils";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  FLOW_MAP_FONT_DEFAULTS,
  flowMapFontBounds,
  type FlowMapFontSection,
} from "./flow-map-font-prefs";

export function FlowMapFontSizeControl({
  section,
  value,
  onChange,
  className,
}: {
  section: FlowMapFontSection;
  value: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const { minPx, maxPx } = flowMapFontBounds();
  const defaultPx = FLOW_MAP_FONT_DEFAULTS[section];
  const atMin = value <= minPx;
  const atMax = value >= maxPx;
  const isDefault = value === defaultPx;

  return (
    <div
      className={cn("inline-flex items-center gap-0.5 rounded border border-slate-700/50 bg-slate-950/40 px-0.5", className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        disabled={atMin}
        aria-label={`Decrease ${section} font size`}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="min-w-[2.25rem] text-center text-[9px] tabular-nums text-slate-400" title="Font size (px)">
        {value}px
      </span>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        disabled={atMax}
        aria-label={`Increase ${section} font size`}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-3 w-3" />
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-200",
          isDefault && "opacity-30 pointer-events-none"
        )}
        aria-label={`Reset ${section} font size to default`}
        title="Reset to default"
        onClick={() => onChange(defaultPx)}
      >
        <RotateCcw className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
