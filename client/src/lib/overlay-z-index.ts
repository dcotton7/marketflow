/** Ticker Review / Theme Charts full-screen viewer layer. */
export const CHART_VIEWER_Z = "z-[3200]";

/** Dialogs opened from inside the chart viewer (above viewer, below toasts). */
export const CHART_VIEWER_DIALOG_Z = "z-[3300]";

/** Popovers/selects portaled from chart viewer dialogs (must sit above dialog + overlay). */
export const CHART_VIEWER_DIALOG_POPOVER_Z = "z-[3400]";

/** Toasts must clear chart viewer + its dialogs. */
export const APP_TOAST_Z = "z-[3500]";
