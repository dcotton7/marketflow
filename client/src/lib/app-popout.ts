/** Shared chrome-less `window.open` helper. Callers name the window (Scanner, InfoPop, …). */

export const APP_POPOUT_CHROME = "menubar=no,toolbar=no,location=no,status=no";

export function openAppPopout(
  url: string,
  windowName: string,
  size: { width: number; height: number },
  existing?: Window | null
): Window | null {
  if (existing && !existing.closed) {
    existing.focus();
    return existing;
  }
  const features = `width=${size.width},height=${size.height},${APP_POPOUT_CHROME}`;
  const w = window.open(url, windowName, features);
  w?.focus();
  return w ?? null;
}
