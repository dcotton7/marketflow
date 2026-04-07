# Spec — Next build: one date/snapshot ruleset (theme tracker is source of truth)

**Goal:** For this release cycle, **all features that load theme snapshots or interpret “how far back”** use the **same rules as the Market Condition theme tracker** (`GET /api/market-condition/themes` and its snapshot pipeline). Reuse **small shared helpers**; avoid one mega-function with unrelated modes.

**Source of truth (theme tracker today):**

| Concern | Authority in code |
|--------|-------------------|
| “Now” / session clock | `getMarketDateTime()` — **America/New_York** → `date`, `hour`, `minute`, `slot` (`theme-snapshots.ts`) |
| What gets written | `saveThemeSnapshots`, `shouldSaveHourlySnapshot`, `shouldSaveDailySnapshot` — **hourly** (15m slots, RTH window), **daily_close** (post 16:00 ET) |
| What baseline is used for comparison | `getHistoricalSnapshot(timeSlice, currentDate, currentHour)` — per-slice queries on `theme_snapshots` (intraday rolling cutoffs, 1D prior trading day, longer slices as implemented) |
| Live theme row | `refreshSnapshot` → `calculateAllThemeMetrics` → ranks/scores in memory + optional `getMarketConditionWithTimeSlice` merge |

Anything that **only** used ad hoc rules (e.g. Race `getRaceTimeline` **UTC calendar** `setUTCDate`, MarketFlow cache **separate** `startOfTradingDayNDaysAgo` duplicate) should **converge** on helpers derived from the **same semantics** as above.

---

## 1. Shared primitives (new or consolidated)

Create **`server/market-condition/utils/theme-tracker-time.ts`** (name flexible) exporting only:

1. **`subtractTradingDays(anchor: Date, tradingDays: number): Date`**  
   - Same behavior as today’s `startOfTradingDayNDaysAgo` walk (UTC day anchor, skip Sat/Sun).  
   - **Single implementation** — `cacheService.ts` imports this; delete the duplicate.

2. **`raceLookbackStart(rangeKey: string, resolution: "intraday" | "daily"): { fromInstant: Date; fromDateStr: string }`**  
   - Maps `RACE_RANGE_DAYS` (or renamed table) to a **`from`** boundary using **trading-day semantics for day-based keys** where the theme tracker would use trading days (e.g. `1d`–`5d`, `2w`/`3w` as **N×5 trading days** or explicit calendar mapping — **pick one table below and document in code**).  
   - **Must not** use raw `setUTCDate(-days)` as the only rule for those keys.

3. **`formatMarketDateET(d: Date): string`** (optional)  
   - If multiple call sites format `YYYY-MM-DD` for `marketDate`; otherwise skip.

**Rule:** `getRaceTimeline` and any future “load snapshots for window” call **`raceLookbackStart`** (or internal equivalent), not private date math.

---

## 2. Range mapping table (product decision — default proposal)

Align **Race UI `range`** with **interpretable** windows consistent with the theme tracker:

| `range` key | Meaning (proposal) |
|-------------|---------------------|
| `1d` … `5d` | Last **N** **trading** days of data (inclusive of sessions that have snapshots), anchored from **today’s ET `marketDate`** |
| `2w` | **10 trading days** (2 × 5) lookback start, OR **14 calendar days** if you insist on wall-clock parity with old race — **choose trading days for tracker alignment** |
| `3w` | **15 trading days** or **21 calendar** — same choice |
| `1mo` / `3mo` / `6mo` / `1y` | **Calendar months/years** from **ET “today”** midnight, or **approximate trading days** — recommend **calendar** for long keys only, documented, using a single `from` derived from `getMarketDateTime().date` string + `Intl`/date-fns, not `setUTCDate` on server UTC `Date` without ET |

Document the chosen row in code comments + this spec.

---

## 3. `getRaceTimeline` changes

**File:** `theme-snapshots.ts`

- Replace `from.setUTCDate(from.getUTCDate() - days)` with a **market-session-aware Race window helper**.
- Race is now **intraday-only**: one frame per stored **15-minute** snapshot.
- **Intraday:** `createdAt >= fromInstant` where short ranges start at **9:30 AM ET** on the first included trading session and long ranges keep calendar semantics.
- Response returns `{ range, resolution: "intraday", frames, fromBoundary, interpretation, terminalState }`.

---

## 4. MarketFlow cache TTL

**File:** `cacheService.ts`

- Import **`subtractTradingDays`** (or the new module’s equivalent) from the shared util; **remove** the local duplicate `startOfTradingDayNDaysAgo`.
- **Keep** `DEFAULT_TTL_MARKET_DAYS = 3` unless product wants strict equality with a theme `timeSlice` — if so, add a one-line comment: *TTL matches “3 trading sessions” same helper as race/theme bounds.*

No change to **cache key** or **payload shape** in this build unless required.

---

## 5. API / client

- **`GET /api/market-condition/race-timeline`** — document intraday-only behavior and **session-open boundary semantics** in `market-condition-and-marketflow-data-rules.md`.
- **`ThemeRaceLanes`** — remove the **Frame** dropdown, default the range to **`5d`**, and make replay controls session-aware:
  - enter on the terminal frame for the current session state
  - `Play` disabled while parked at the terminal frame
  - `Restart` rewinds to frame 0 and enables replay
  - `Pause` / `Last` keep their normal meaning

---

## 6. Tests (minimum)

1. **`subtractTradingDays`**: Fri → Mon back 1 trading day; span across weekend.  
2. **`raceLookbackStart`**: for a fixed mocked `getMarketDateTime` (inject clock or pass anchor in test-only export), `3d` returns expected `fromDateStr`.  
3. **Regression:** `getRaceTimeline` with empty DB still `[]`; with fixture rows, count of frames ≥ prior behavior for same synthetic data (adjust fixture dates to new boundary if needed).

---

## 7. Out of scope (this build)

- Score presets / `scoreProfileId` on snapshots  
- Changing **`getHistoricalSnapshot`** branch logic (only **reuse date primitives** at edges)  
- Alpaca bar windows (`TIME_SLICE_DAYS` on members) — separate pass if needed

---

## 8. Acceptance criteria

- [x] One shared **trading-day walk** implementation; **cacheService** and **race lookback** both use it.  
- [x] **No** standalone `setUTCDate(-N)` for race **day-based** ranges without going through the shared mapper.  
- [x] Docs updated: `market-condition-and-marketflow-data-rules.md` race section reflects **theme-tracker-aligned** boundaries.  
- [x] Manual QA: same **ET session**, Race “3d” intraday span **feels** consistent with theme history expectations (no off-by-one weekend surprise vs old UTC calendar).  

Verified in local dev on 2026-04-01 using the shared helper tests plus live `race-timeline` endpoint checks:
- `3d` intraday returns `fromBoundary=2026-03-27T00:00:00.000Z` with `interpretation="trading"`
- `1mo` daily returns `fromBoundary=2026-03-02T00:00:00.000Z` with `interpretation="calendar"`
- `ThemeRaceLanes` now renders the returned boundary semantics in subtitle/help copy instead of inferring from the first loaded frame

---

## 9. Rollout

1. Land util + tests.  
2. Switch `getRaceTimeline`.  
3. Point `cacheService` at util (delete duplicate).  
4. Doc + client copy.  

If boundary changes shift frame counts materially, note in changelog for users who screenshot timelines.
