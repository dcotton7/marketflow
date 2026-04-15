export const DEFAULT_HORIZONTAL_DRAWING_COLOR = "#ff6d00";
export const DEFAULT_HORIZONTAL_DRAWING_WIDTH = 1;
export const DEFAULT_HORIZONTAL_DRAWING_LINE_STYLE = "solid" as const;

export type HorizontalDrawingLineStyle = "solid" | "dotted" | "dashed";

const LS_DEFAULT_COLOR = "chartHorizontalDrawingDefaultColor";
const LS_DEFAULT_WIDTH = "chartHorizontalDrawingDefaultWidth";
const LS_DEFAULT_LINE_STYLE = "chartHorizontalDrawingDefaultLineStyle";

const VALID_LINE_STYLES: HorizontalDrawingLineStyle[] = ["solid", "dotted", "dashed"];

function normalizeHex6(color: string): string | null {
  const s = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return null;
}

/** Normalize any user/chart color string to a 6-digit hex for inputs and storage. */
export function resolveHorizontalDrawingHex(c: string | undefined): string {
  if (!c || typeof c !== "string") return DEFAULT_HORIZONTAL_DRAWING_COLOR;
  return normalizeHex6(c) || DEFAULT_HORIZONTAL_DRAWING_COLOR;
}

export function clampHorizontalDrawingWidth(w: unknown): number {
  const n = typeof w === "number" ? w : parseInt(String(w), 10);
  if (!Number.isFinite(n)) return DEFAULT_HORIZONTAL_DRAWING_WIDTH;
  return Math.min(4, Math.max(1, Math.round(n)));
}

export function clampHorizontalDrawingLineStyle(s: unknown): HorizontalDrawingLineStyle {
  if (typeof s === "string" && (VALID_LINE_STYLES as readonly string[]).includes(s)) {
    return s as HorizontalDrawingLineStyle;
  }
  return DEFAULT_HORIZONTAL_DRAWING_LINE_STYLE;
}

/** Saved defaults for *new* horizontal lines (localStorage). */
export function getHorizontalDrawingDefaults(): {
  color: string;
  width: number;
  lineStyle: HorizontalDrawingLineStyle;
} {
  try {
    const c = localStorage.getItem(LS_DEFAULT_COLOR);
    const w = localStorage.getItem(LS_DEFAULT_WIDTH);
    const ls = localStorage.getItem(LS_DEFAULT_LINE_STYLE);
    return {
      color: c ? resolveHorizontalDrawingHex(c) : DEFAULT_HORIZONTAL_DRAWING_COLOR,
      width: w != null ? clampHorizontalDrawingWidth(parseInt(w, 10)) : DEFAULT_HORIZONTAL_DRAWING_WIDTH,
      lineStyle: ls ? clampHorizontalDrawingLineStyle(ls) : DEFAULT_HORIZONTAL_DRAWING_LINE_STYLE,
    };
  } catch {
    return {
      color: DEFAULT_HORIZONTAL_DRAWING_COLOR,
      width: DEFAULT_HORIZONTAL_DRAWING_WIDTH,
      lineStyle: DEFAULT_HORIZONTAL_DRAWING_LINE_STYLE,
    };
  }
}

export function setHorizontalDrawingDefaults(
  color: string,
  width: number,
  lineStyle: HorizontalDrawingLineStyle
): void {
  const hex = normalizeHex6(color) || DEFAULT_HORIZONTAL_DRAWING_COLOR;
  const w = clampHorizontalDrawingWidth(width);
  const style = clampHorizontalDrawingLineStyle(lineStyle);
  try {
    localStorage.setItem(LS_DEFAULT_COLOR, hex);
    localStorage.setItem(LS_DEFAULT_WIDTH, String(w));
    localStorage.setItem(LS_DEFAULT_LINE_STYLE, style);
  } catch {
    /* ignore */
  }
}

/** @deprecated New lines use getHorizontalDrawingDefaults(); kept for any legacy callers */
let lastHorizontalColor = DEFAULT_HORIZONTAL_DRAWING_COLOR;

export function getLastHorizontalDrawingColor(): string {
  return lastHorizontalColor;
}

export function setLastHorizontalDrawingColor(color: string): void {
  const hex = normalizeHex6(color);
  if (hex) lastHorizontalColor = hex;
}
