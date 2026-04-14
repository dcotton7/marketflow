/** Dispatched on `window` so any widget can open the header Watchlist Manager dialog. */
export const SENTINEL_OPEN_WATCHLIST_MANAGER_EVENT = "sentinel:open-watchlist-manager";

export function requestOpenSentinelWatchlistManager(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SENTINEL_OPEN_WATCHLIST_MANAGER_EVENT));
}
