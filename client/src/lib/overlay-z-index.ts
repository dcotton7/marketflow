/** Ticker Review / Theme Charts full-screen viewer layer. */
export const CHART_VIEWER_Z = "z-[3200]";

/** Chart-load status card (corner, no backdrop) — above viewer, below scanner. */
export const CHART_VIEWER_DIALOG_Z = "z-[3300]";

/**
 * Discovery Scanner floating overlay — above chart viewer + load card so Signals
 * stay clickable while charts are open / loading.
 */
export const SCANNER_OVERLAY_Z = 3400;

/** Popovers/selects portaled from chart viewer dialogs (must sit above dialog + overlay). */
export const CHART_VIEWER_DIALOG_POPOVER_Z = "z-[3450]";

/** Toasts must clear chart viewer + scanner + dialogs. */
export const APP_TOAST_Z = "z-[3500]";
