import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { pickForegroundForBg } from "@/lib/readable-on-bg";
import { UNLINKED_ACCENT_COLOR } from "./dashboard-persistence";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function normalizeHex(c: string): string {
  return c.trim().toLowerCase();
}

/** For header controls built outside this file; mirrors palette lane detection in the chrome. */
export function paletteLaneHeaderControlClass(
  accentColor?: string,
  neutralAccentHex: string = UNLINKED_ACCENT_COLOR
): string | undefined {
  if (!accentColor || normalizeHex(accentColor) === normalizeHex(neutralAccentHex)) {
    return undefined;
  }
  return "text-inherit hover:bg-black/10 dark:hover:bg-white/10";
}

/** When set, link-lane group picker + header controls should match the accent header. */
export type StartHereChromeHeaderContextValue = {
  accentHeader: true;
  fg: string;
  /**
   * Apply to each header control (not the drag-handle row). Never style header `button:hover`
   * from the row — hovering one child still matches `:hover` on the ancestor and lights up every button.
   */
  headerControlClass: string;
};

export const StartHereChromeHeaderContext =
  createContext<StartHereChromeHeaderContextValue | null>(null);

export function useStartHereChromeHeaderContext() {
  return useContext(StartHereChromeHeaderContext);
}

export function StartHereWidgetChrome({
  title,
  cssVariables,
  onClose,
  headerExtra,
  headerTitleSlot,
  accentColor,
  accentLabel,
  neutralAccentColor = UNLINKED_ACCENT_COLOR,
  frameClassName,
  children,
}: {
  title: string;
  cssVariables: CssVariables;
  onClose: () => void;
  headerExtra?: ReactNode;
  /** Replaces the default title text in the drag header (keep `title` for accessibility). */
  headerTitleSlot?: ReactNode;
  /** Lane / group color; link lanes tint the frame + title bar */
  accentColor?: string;
  accentLabel?: string;
  /** Matches admin “Unlinked” workspace color so private groups still get muted chrome. */
  neutralAccentColor?: string;
  /** Extra classes on the outer chrome (e.g. focus ring for selected chart). */
  frameClassName?: string;
  children: ReactNode;
}) {
  const paletteChrome = Boolean(
    accentColor && normalizeHex(accentColor) !== normalizeHex(neutralAccentColor)
  );
  const headerFg = accentColor && paletteChrome ? pickForegroundForBg(accentColor) : null;

  const chromeHeaderCtx = useMemo(
    (): StartHereChromeHeaderContextValue | null =>
      paletteChrome && headerFg
        ? {
            accentHeader: true,
            fg: headerFg,
            headerControlClass:
              "text-inherit hover:bg-black/10 dark:hover:bg-white/10",
          }
        : null,
    [paletteChrome, headerFg]
  );

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg shadow-sm",
        paletteChrome ? "border-2" : "border",
        frameClassName
      )}
      style={{
        backgroundColor: cssVariables.overlayBg,
        borderColor: paletteChrome && accentColor ? accentColor : `${cssVariables.secondaryOverlayColor}66`,
        boxShadow:
          accentColor && !paletteChrome ? `inset 4px 0 0 0 ${accentColor}` : undefined,
      }}
      aria-label={accentLabel ? `${title} · ${accentLabel} group` : undefined}
    >
      <StartHereChromeHeaderContext.Provider value={chromeHeaderCtx}>
        <div
          className="start-here-drag-handle flex flex-shrink-0 flex-wrap cursor-move items-center gap-2 border-b px-3 py-2 select-none"
          style={
            paletteChrome && accentColor
              ? {
                  borderColor: `color-mix(in srgb, ${accentColor}, #000 22%)`,
                  backgroundColor: accentColor,
                  color: headerFg ?? undefined,
                }
              : {
                  borderColor: `${cssVariables.secondaryOverlayColor}44`,
                  backgroundColor: cssVariables.headerBg,
                }
          }
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-2 font-semibold"
            style={
              paletteChrome && headerFg
                ? { color: headerFg, fontSize: cssVariables.fontSizeHeader }
                : { color: cssVariables.textColorHeader, fontSize: cssVariables.fontSizeHeader }
            }
          >
            {headerTitleSlot ?? <span className="min-w-0 truncate">{title}</span>}
          </div>
          {headerExtra ? <span className="start-here-no-drag">{headerExtra}</span> : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              "start-here-no-drag h-8 w-8 flex-shrink-0",
              chromeHeaderCtx?.headerControlClass
            )}
            onClick={onClose}
            aria-label="Close widget"
          >
            <X
              className="h-4 w-4"
              style={{
                color: paletteChrome && headerFg ? headerFg : cssVariables.textColorSmall,
              }}
            />
          </Button>
        </div>
      </StartHereChromeHeaderContext.Provider>
      <div className="min-h-0 flex-1 overflow-hidden p-2">{children}</div>
    </div>
  );
}
