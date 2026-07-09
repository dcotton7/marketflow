// ---------------------------------------------------------------------------
// Scanner font preferences — single global offset applied to all text
// ---------------------------------------------------------------------------

export type ScannerFontSection = "card" | "headline";

export type ScannerFontPrefs = Record<ScannerFontSection, number>;

/** Base sizes for different text roles within the scanner */
export const SCANNER_BASE_SIZES = {
  headline: 12,
  card: 11,
  body: 10,
  small: 9,
  tiny: 8,
} as const;

/** The control stores just an offset (default 0). Each text element = base + offset. */
export const SCANNER_FONT_DEFAULTS: ScannerFontPrefs = {
  card: 0,
  headline: 0,
};

const STORAGE_KEY = "scanner-font-offset-v2";
const MIN_OFFSET = -3;
const MAX_OFFSET = 6;

function storageKey(userId: number | undefined): string {
  return userId ? `${STORAGE_KEY}:user-${userId}` : `${STORAGE_KEY}:anon`;
}

function clampOffset(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(n)));
}

export function loadScannerFontOffset(userId?: number): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return 0;
    return clampOffset(JSON.parse(raw));
  } catch {
    return 0;
  }
}

export function saveScannerFontOffset(userId: number | undefined, offset: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(clampOffset(offset)));
  } catch { /* ignore quota */ }
}

/** Compute a pixel size for a given base role, applying the global offset */
export function scannerPx(base: keyof typeof SCANNER_BASE_SIZES, offset: number): number {
  return Math.max(7, SCANNER_BASE_SIZES[base] + offset);
}

export function scannerFontBounds() {
  return { minPx: MIN_OFFSET, maxPx: MAX_OFFSET };
}

// Legacy compat
export function loadScannerFontPrefs(userId?: number): ScannerFontPrefs {
  const offset = loadScannerFontOffset(userId);
  return { card: offset, headline: offset };
}

export function saveScannerFontPrefs(userId: number | undefined, prefs: ScannerFontPrefs): void {
  saveScannerFontOffset(userId, prefs.card);
}
