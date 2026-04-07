# Market Condition vs MarketFlow: date ranges, storage, scoring, sorting

This document ties together **when data is captured**, **what window it covers**, **how theme scores are computed**, and **how the UI sorts**—so product and engineering stay aligned.

**Target (next build):** use **theme tracker rules** for all snapshot windows and shared date math — see **`docs/spec-next-build-theme-tracker-unified-dates.md`**.

---

## 1. MarketFlow analysis cache (per symbol)

**Where:** `server/market-condition/analysis/cacheService.ts`

| Rule | Value |
|------|--------|
| **TTL** | **3 market (trading) days**: current session counts as day 1; cache is valid if `generatedAt` is on or after the **start of the trading day that is 2 trading days before today** (UTC midnight anchor, weekends skipped when walking back). |
| **Constant** | `DEFAULT_TTL_MARKET_DAYS = 3` |
| **Version** | `VERSION = "v1"` stored with payload |
| **Key** | One row per **symbol** (`marketflow_analysis_cache.symbol`) |

**Implication:** MarketFlow output is **not** tied to the Race scrubber’s `range` query. It is **“fresh enough for the last few sessions”** in **trading-day** terms, not calendar `1d`/`3d` race windows.

**Helper:** `subtractTradingDays(from, tradingDaysBack)` from `server/market-condition/utils/theme-tracker-time.ts` — walks **UTC calendar dates** backward, skipping Sat/Sun. Shared with race and theme snapshot features for consistency.

---

## 2. Theme snapshot storage (DB → Race + historical comparison)

**Where:** `server/market-condition/engine/snapshot.ts` (`saveHistoricalSnapshotsIfNeeded`)  
**Persistence:** `server/market-condition/engine/theme-snapshots.ts` (`saveThemeSnapshots`, `shouldSaveHourlySnapshot`, `shouldSaveDailySnapshot`)  
**Clock:** `getMarketDateTime()` — **America/New_York** wall time → `date`, `hour`, `minute`, **15-minute `slot`** (0, 15, 30, 45).

### Intraday (`snapshotType = "hourly"`)

| Rule | Detail |
|------|--------|
| **Cadence** | One save per **new** 15-minute **slot** (in-memory `lastIntradaySnapshot` tracks date/hour/slot). |
| **Weekdays** | No saves Sat/Sun (`currentDate` parsed as UTC noon for DOW check). |
| **Session** | Roughly **9:30 AM–4:00 PM ET**: `hour < 9` or `hour > 15` → no save; **9:00** hour requires **`slot >= 30`** (9:30+). |
| **Cleanup** | **Historical snapshots are NEVER deleted on startup.** Old hourly snapshots (previous days) are automatically cleaned up when saving new data. |

### Daily close (`snapshotType = "daily_close"`)

| Rule | Detail |
|------|--------|
| **When** | Weekdays only; **`currentHour >= 16` ET**; **once per `marketDate`** (`lastDailySnapshot`). |

### Race timeline read path

**Where:** `getRaceTimeline(range)` in `theme-snapshots.ts`

| Source | Window |
|--------|--------|
| **15-minute intraday snapshots** (`snapshotType = "hourly"`) | `createdAt >= fromInstant`, where short ranges use an **exchange-calendar, 9:30 AM ET session-open anchor** and long ranges continue to use calendar lookback. |

**Buckets:** Intraday frames are grouped into **15-minute UTC epoch buckets** (`floor(ms / 15min) * 15min`) for one row per bucket per theme batch.

**Note:** Race is now an **intraday-only replay**. The old UI `Frame` dropdown is gone; every replay step is one stored **15-minute** market snapshot.

#### Race boundary semantics (updated)

**As of current build:** Race timeline queries now use a market-session-aware window helper:

- **Short ranges** (`1d`-`5d`, `2w`, `3w`): **Trading-day semantics** using the Alpaca trading calendar, anchored to **9:30 AM ET** on the start session
- **Long ranges** (`1mo`, `3mo`, `6mo`, `1y`): **Calendar-day** arithmetic for simplicity  
- Before **9:30 AM ET**, Race excludes today and stops at the **last completed market session**
- After hours, Race stops at the **final intraday frame from the regular session**
- Source: `server/market-condition/utils/theme-tracker-time.ts`

This provides consistent date handling across Race, MarketFlow cache, and other theme features. Race queries now use `getRaceTimelineWindow(range)` which returns:
- `fromInstant`: Date object for intraday `createdAt >= from` queries
- `fromDateStr`: YYYY-MM-DD string for the anchored session start date
- `interpretation`: "trading" or "calendar" for debugging/UI tooltips
- `terminalState`: `LIVE`, `AFTER_HOURS`, `PRE_OPEN`, or `CLOSED`

`GET /api/market-condition/race-timeline` now returns `fromBoundary`, `interpretation`, and `terminalState` alongside `frames`, so the client can explain both the active lookback window and the current replay state without inferring it from the first/last stored frame.

---

## 3. GET `/api/market-condition/themes` — time slice & baselines

**Where:** `server/market-condition/routes.ts`

| Input | Effect |
|--------|--------|
| `timeSlice` | `TODAY`, `15M`, `30M`, `1H`, `4H`, `1D`, `5D`, `1W`, `1M`, … — validated list in route. |
| `sizeFilter` / `useIntradayBaseline` | May **force `refreshSnapshot`** so theme math uses current poll + filters. |
| `rotationBaseline=open930` | With `TODAY`, uses **open baseline** path (`getMarketConditionWithOpenBaseline`). |

**Historical comparison** (non-`TODAY`): `getMarketConditionWithTimeSlice` + DB snapshots via `getHistoricalSnapshot` (`theme-snapshots.ts`):

- **15M / 30M / 1H / 4H:** snapshot on **`marketDate = today` (ET date)**, `hourly`, `createdAt <= now - N`.
- **1D:** prior **trading** day’s daily (weekend skip in date walk).
- Longer slices: additional cases in `getHistoricalSnapshot` (see file).

**Member bars / windows** (separate from theme score): `TIME_SLICE_DAYS`, `TRADING_DAYS_BACK`, intraday slices in `routes.ts` for `/themes/:id/members`.

---

## 4. Theme score (FlowScore) — definition

**Where:** `server/market-condition/engine/theme-score.ts`  
**Weights:** `THEME_SCORE_WEIGHTS` in `server/market-condition/universe.ts`

Per refresh, for each theme:

1. Raw: **median** member % change, **median** RS vs benchmark, breadth blend (`0.6 * pctAbove50d + 0.4 * pctAbove200d`), **acceleration** = current median RS − **stored** `previousRS` (from last in-memory refresh / snapshot seed).
2. **Percentile-rank** each of those across **all themes** → four components in `[0,1]`.
3. **Base score** = weighted sum (40% / 20% / 20% / 20%).
4. **Narrow leadership** multiplier from top-3 positive contribution (`NARROW_LEADERSHIP_CONFIG`).
5. Sort themes by final score → **`rank`**, **`deltaRank`** vs previous rankings map.

**Stored snapshots** persist `rank`, `score`, `medianPct`, `rsVsBenchmark`, `breadthPct`, etc., for Race frames and comparison — those values are **whatever the engine computed at save time**, not recomputed when you change the client sort.

---

## 5. UI sorting (theme grid / race lane list order)

**Where:** `client/src/pages/MarketConditionPage.tsx` — `sortedThemes` `useMemo`

| Lens | Sort key (desc unless noted) |
|------|-------------------------------|
| **flow** | `score` (or `historicalMetrics.score` if historical sort + non-TODAY) |
| **rotation** | `score - historicalMetrics.score` (improvement), tie-break `score`; else **`deltaRank`** then `score` |
| **concentration** | `top3Contribution` (or `top3Concentration/100`) |
| **accumulation** | `accDistDays` |
| **race** | `acceleration` then `score` |

This order is **client-side** and can differ from **`theme.rank`** on the row, which comes from the **server’s** last full scoring pass for the active `timeSlice` / baseline.

---

## 6. MarketFlow modules vs theme scores

**Example:** `server/market-condition/analysis/modules/fundFlow.ts` uses `getAllThemes()` from the **live snapshot engine** (`getAllThemes()` / snapshot state) and averages **`t.score`** for the symbol’s themes to label **themeFlow** (`inflow` / `outflow` / `neutral`).

So MarketFlow’s “theme flow” reflects **current snapshot scores**, not the Race scrubber range or cached analysis age—except that stale MarketFlow **cache** can still serve an old **module payload** until TTL expires.

---

## 7. Quick reference: “what date range am I using?”

| Feature | Range type | Primary code |
|---------|------------|--------------|
| MarketFlow cache validity | **3 trading days** (TTL) | `cacheService.ts` + shared `subtractTradingDays()` |
| Race API `?range=` | **Trading days for short ranges, calendar for long** | `getRaceTimeline` + shared `raceLookbackStart()` |
| Theme `timeSlice` comparison | **Snapshot + trading/calendar rules per slice** | `getHistoricalSnapshot` |
| 15m intraday DB saves | **ET session + 15m slots** | `shouldSaveHourlySnapshot` |

When adding features (e.g. score profiles), keep **snapshot `scoreProfileId`** and **cache keys** in mind so historical replay, MarketFlow, and the grid don’t silently disagree.
