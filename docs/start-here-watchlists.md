# Watchlists: canonical vs legacy (Start Here)

**Canonical (named watchlists — use for new work):**

- API: `GET/POST /api/sentinel/watchlists`, `GET /api/sentinel/watchlist?watchlistId=…`
- Client hooks: `useWatchlists`, `useNamedWatchlistItems`, `WATCHLIST_MANAGER_STORAGE_KEY` in `@/hooks/use-watchlist`
- UI: `WatchlistModal` (Watchlist Manager), `WatchlistSelector` on charts/Big Idea (default storage key = manager key)
- Start Here portal: `WatchlistPortalWidget` uses the same storage key and named-list APIs only

**Legacy (do not change unless explicitly requested):**

- `client/src/pages/WatchlistPage.tsx` — older watchlist page
- `client/src/components/WatchlistWidget.tsx` — sidebar widget using `sidebarWatchlistId` and `useWatchlist(id)` without the manager key alignment
- Dashboard blocks that post to older watchlist paths without `watchlistId` context

Refactoring legacy surfaces to the named-list model is out of scope unless you ask for it.
