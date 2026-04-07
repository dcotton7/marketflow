import type { ReactNode } from "react";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function StartHereWidgetChrome({
  title,
  cssVariables,
  onClose,
  headerExtra,
  accentColor,
  accentLabel,
  children,
}: {
  title: string;
  cssVariables: CssVariables;
  onClose: () => void;
  headerExtra?: ReactNode;
  /** Left stripe + focus ring hint for linked widget groups */
  accentColor?: string;
  accentLabel?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border shadow-sm"
      style={{
        backgroundColor: cssVariables.overlayBg,
        borderColor: `${cssVariables.secondaryOverlayColor}66`,
        boxShadow: accentColor ? `inset 4px 0 0 0 ${accentColor}` : undefined,
      }}
      aria-label={accentLabel ? `${title} · ${accentLabel} group` : undefined}
    >
      <div
        className="start-here-drag-handle flex flex-shrink-0 flex-wrap cursor-move items-center gap-2 border-b px-3 py-2 select-none"
        style={{
          borderColor: `${cssVariables.secondaryOverlayColor}44`,
          backgroundColor: cssVariables.headerBg,
        }}
      >
        <span
          className="min-w-0 flex-1 truncate font-semibold"
          style={{ color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeHeader }}
        >
          {title}
        </span>
        {headerExtra ? <span className="start-here-no-drag">{headerExtra}</span> : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="start-here-no-drag h-8 w-8 flex-shrink-0"
          onClick={onClose}
          aria-label="Close widget"
        >
          <X className="h-4 w-4" style={{ color: cssVariables.textColorSmall }} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">{children}</div>
    </div>
  );
}
