// ---------------------------------------------------------------------------
// Scanner font size control — global offset that affects all text in the panel
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { scannerFontBounds } from "./scanner-font-prefs";

export function ScannerFontSizeControl({
  value,
  onChange,
  className,
  section: _section,
}: {
  section?: string;
  value: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const { minPx: minOffset, maxPx: maxOffset } = scannerFontBounds();
  const atMin = value <= minOffset;
  const atMax = value >= maxOffset;
  const isDefault = value === 0;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded border border-slate-700/50 bg-slate-950/40 px-0.5",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        disabled={atMin}
        aria-label="Decrease font size"
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span
        className="min-w-[2rem] text-center text-[9px] tabular-nums text-slate-400"
        title="Font offset (all text)"
      >
        {value >= 0 ? `+${value}` : `${value}`}
      </span>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        disabled={atMax}
        aria-label="Increase font size"
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
        aria-label="Reset font size to default"
        title="Reset to default"
        onClick={() => onChange(0)}
      >
        <RotateCcw className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
