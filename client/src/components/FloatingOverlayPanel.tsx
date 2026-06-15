import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ThemeColorChip } from "@/components/theme/ThemeColorChip";
import { cn } from "@/lib/utils";
import { GripVertical, Pin, X } from "lucide-react";

export interface FloatingOverlayPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageKey: string;
  defaultState?: { x: number; y: number; w: number; h: number; pinned: boolean };
  titleBar: ReactNode;
  children: ReactNode;
  className?: string;
  /** Admin overlay surface (Theme Charts, etc.) — falls back to slate when omitted */
  surfaceBg?: string;
  borderColor?: string;
  titleBarBg?: string;
  /** Local theme slot for overlay body (Secondary BG default) */
  surfaceSlotId?: string;
  /** Local theme slot for overlay title bar */
  titleBarSlotId?: string;
}

const DEFAULT_FLOAT = { x: 80, y: 60, w: 560, h: 620, pinned: false };

/** ~92% of viewport, centered — good default for Ticker Review / large overlays on laptop screens. */
export function laptopOverlayDefault(margin = 20): typeof DEFAULT_FLOAT {
  if (typeof window === "undefined") {
    return { x: 24, y: 24, w: 1360, h: 840, pinned: false };
  }
  const w = Math.max(720, Math.min(1560, Math.floor(window.innerWidth * 0.94) - margin));
  const h = Math.max(560, Math.min(940, Math.floor(window.innerHeight * 0.9) - margin));
  const x = Math.max(margin, Math.round((window.innerWidth - w) / 2));
  const y = Math.max(margin, Math.round((window.innerHeight - h) / 2));
  return { x, y, w, h, pinned: false };
}

function loadState(
  storageKey: string,
  defaults: typeof DEFAULT_FLOAT
): typeof DEFAULT_FLOAT {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.x === "number") {
        const w = Math.max(320, Math.min(window.innerWidth - 40, parsed.w));
        const h = Math.max(240, Math.min(window.innerHeight - 40, parsed.h));
        const x = Math.max(0, Math.min(window.innerWidth - w, parsed.x));
        const y = Math.max(0, Math.min(window.innerHeight - h, parsed.y));
        return { ...defaults, ...parsed, x, y, w, h };
      }
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function FloatingOverlayPanel({
  open,
  onOpenChange,
  storageKey,
  defaultState = DEFAULT_FLOAT,
  titleBar,
  children,
  className,
  surfaceBg,
  borderColor,
  titleBarBg,
  surfaceSlotId,
  titleBarSlotId,
}: FloatingOverlayPanelProps) {
  const [floatState, setFloatState] = useState(() =>
    typeof window !== "undefined" ? loadState(storageKey, defaultState) : defaultState
  );
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(
    null
  );
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(
    null
  );

  const persist = (next: Partial<typeof floatState>) => {
    setFloatState((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(storageKey, JSON.stringify(merged));
      } catch {
        /* ignore */
      }
      return merged;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const dw = e.clientX - resizeRef.current.startX;
        const dh = e.clientY - resizeRef.current.startY;
        const w = Math.max(320, Math.min(window.innerWidth - 40, resizeRef.current.startW + dw));
        const h = Math.max(240, Math.min(window.innerHeight - 40, resizeRef.current.startH + dh));
        persist({ w, h });
        return;
      }
      if (!dragRef.current) return;
      const x = Math.max(0, dragRef.current.startLeft + (e.clientX - dragRef.current.startX));
      const y = Math.max(0, dragRef.current.startTop + (e.clientY - dragRef.current.startY));
      persist({ x, y });
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [open]);

  if (!open) return null;

  const onTitleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: floatState.x,
      startTop: floatState.y,
    };
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border shadow-2xl overflow-hidden",
        !surfaceBg && "bg-slate-900",
        !borderColor && "border-slate-700",
        floatState.pinned && "ring-2 ring-cyan-500/50",
        className
      )}
      style={{
        position: "fixed",
        left: floatState.x,
        top: floatState.y,
        width: floatState.w,
        height: floatState.h,
        zIndex: floatState.pinned ? 9999 : 1500,
        backgroundColor: surfaceBg,
        borderColor: borderColor,
      }}
      data-ui-region={surfaceSlotId}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 border-b cursor-grab active:cursor-grabbing select-none shrink-0",
          !titleBarBg && "bg-slate-800/80",
          !borderColor && "border-slate-700"
        )}
        style={{
          backgroundColor: titleBarBg,
          borderColor: borderColor,
        }}
        onMouseDown={onTitleMouseDown}
      >
        <GripVertical className="w-4 h-4 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0">{titleBar}</div>
        <div className="flex items-center gap-1 shrink-0">
          {titleBarSlotId ? <ThemeColorChip slotId={titleBarSlotId} /> : null}
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", floatState.pinned && "text-cyan-400")}
            onClick={() => persist({ pinned: !floatState.pinned })}
            title={floatState.pinned ? "Unpin" : "Pin on top"}
          >
            <Pin className={cn("w-4 h-4", floatState.pinned && "fill-current")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="relative flex-1 overflow-auto p-4 min-h-0">
        {surfaceSlotId ? (
          <div className="pointer-events-none absolute right-3 top-2 z-10 flex justify-end">
            <div className="pointer-events-auto">
              <ThemeColorChip slotId={surfaceSlotId} />
            </div>
          </div>
        ) : null}
        {children}
      </div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize border-l border-t border-slate-600 rounded-tl"
        title="Resize"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startW: floatState.w,
            startH: floatState.h,
          };
        }}
      />
    </div>
  );
}
