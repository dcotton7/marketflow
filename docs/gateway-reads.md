# Gateway reads for Quinn (26 Nov 2026)

What Quinn (Anitir) can now read through the Anima gateway (`server/middleware/animaGateway.ts`), built from Don's
answers of 26 Nov to the reach spec's group 3. Every route here is a GET, runs as the gateway's owner user, reads only
what MarketFlow already stores, and never calls a vendor or a model on Quinn's behalf (the two exceptions are named:
the VIX quote and the sentinel ticker lookup). Code: `server/gateway-reads/`, tests: `npm run test:gateway-reads`.

## 1. Earnings dates

### How MarketFlow gets them today

- **The vendor is Finnhub's market-wide earnings calendar** (`/calendar/earnings?from=&to=`, the key already in use).
  The setups job (`server/setups/jobs.ts`, job `earnings_calendar`) pulls it once a weekday between 18:00 and 20:00 ET,
  for the next 91 days, in 7-day windows (13 calls; a window that hits Finnhub's 1,500-row cap is re-asked day by day).
  It keeps the rows for symbols MarketFlow follows (anything with daily bars or a tickers row) in
  `earnings_estimates_daily`, one set per pull day (`fetched_on`), append-only. Each row: symbol, report date, hour
  (`bmo` / `amc` / `dmh` / empty), EPS and revenue estimates, fiscal year and quarter, `source = finnhub_calendar`,
  `first_seen_at`. If one window fails, nothing is stored for that day and the previous day's pull stays in use.
- **Freshness:** at best the previous evening's pull; over a weekend or holiday, Friday's. A missed evening is caught
  up the next one (the job skips a day only when that day's pull is already stored).
- **The second source is per ticker:** `tickers.next_earnings_date` / `earnings_time`, written when a ticker's
  fundamentals are fetched (`server/fundamentals.ts`: FMP's `/earnings?symbol=`, Finnhub's when FMP has none), with a
  one-day TTL that only refreshes when someone reads that ticker. Most stored dates were already past when the research
  checked (515 of 633), which is why the calendar job exists; the app now prefers the calendar
  (`withUpcomingEarnings`) and never shows a past date as upcoming.
- **`GET /api/scanner/upcoming-earnings?symbols=` (up to 20)** reads `getCachedEarningsData` per symbol: one SELECT on
  `tickers` each, merged with the latest calendar pull held in memory. **It does not call a vendor** (the function is
  "cache-only, never triggers API calls"); the reach spec's "a cold cache calls the vendor once per ticker" is not what
  the code does. It is still not the read Quinn needs: no time-of-day words, no source, no as-of.
- **`server/earnings/sec.ts`** reads SEC filings for *past* reports (the Earnings Gap Up setup); it has no upcoming dates.
- **Limits:** Finnhub's calendar does not say whether a date is confirmed by the company; nothing in MarketFlow does.
  Symbols MarketFlow does not follow are dropped from the pull. The pull covers 91 days.

### What is now readable

`GET /api/market-condition/earnings/upcoming?symbols=NVDA,CRM` (up to 50; more are dropped and counted), or
`?days=N` (1-30, default 7): every report from today through N-1 days ahead, across the liquid universe (20-day
average dollar volume of at least $100M over the last 20 stored daily bars, the setups' "liquid"), at most 300 rows,
sorted by date then dollar volume. Served from the newest pull; a symbol not on it falls back to the ticker's stored
date (if not past); otherwise `unknown` with the reason. Cached 10 minutes. No vendor call, ever.

```json
{"mode":"symbols","today":"2026-11-26",
 "calendar":{"fetchedOn":"2026-11-25","pulledAt":"2026-11-25T23:12:04.000Z","horizonDays":91,"stale":false,"source":"Finnhub earnings calendar (market-wide, pulled once a day after the close)"},
 "rows":[
  {"symbol":"CRM","status":"scheduled","date":"2026-12-02","daysAway":6,"timeOfDay":"after_close","confirmed":null,"listedSince":"2026-10-28","epsEstimate":2.86,"asOf":"2026-11-25","source":"finnhub_calendar"},
  {"symbol":"XYZ","status":"unknown","date":null,"daysAway":null,"timeOfDay":null,"confirmed":null,"listedSince":null,"epsEstimate":null,"asOf":null,"source":null,
   "reason":"no report date in the 91 days after 2026-11-25 on Finnhub's calendar, and no stored upcoming date"}],
 "notes":["confirmed is null: Finnhub's calendar does not say whether the company confirmed a date. listedSince is the first daily pull that carried the same date.", "..."]}
```

`timeOfDay`: `before_open` (bmo), `after_close` (amc), `during_market` (dmh), `unknown`. `confirmed` is always null
(the vendor does not say); `listedSince` (the first pull that carried the same date) is the honest stand-in. `stale`
is true when the newest pull is more than 4 days old. Window rows add `dollarVol20`. Unknown reasons: no pull stored
yet; MarketFlow does not follow the symbol; no date within 91 days of the pull.

## 2. The real VIX

`GET /api/market-condition/setups/vix` (allowed on the gateway) now carries `reading`:

```json
{"reading":{"kind":"VIX","label":"Cboe Volatility Index (VIX)","price":17.2,"changePct":-3.1,"previousClose":17.75,
  "quoteTime":"2026-11-26T14:45:00.000Z","fetchedAt":"2026-11-26T15:01:12.000Z",
  "delayed":"Cboe index via FMP: a delayed quote, about 15 minutes behind","source":"Cboe VIX via FMP","isFallback":false},
 "realVix":{...}, "marketCardUses":"VIXY proxy and SPY realized volatility (rules and stored rows unchanged)", "regimeAndSentinelUseRealVix":false, "note":null}
```

When FMP does not answer: `"kind":"VIXY_FALLBACK"`, `"label":"VIXY ETF (fallback: NOT the VIX; FMP did not answer)"`,
`"isFallback":true`, `"delayed":null`, with VIXY's price from one Alpaca quote (null if that fails too). Cost: one FMP
quote a minute at most (cached 60 s, `vix-source.ts`); the VIXY quote only on the fallback. `quoteTime` is FMP's own
timestamp when the body carries one; `fetchedAt` is when MarketFlow fetched it. Whether FMP's `/stable/quote` body for
`^VIX` carries `timestamp` was not checked live (no key here); if it does not, `quoteTime` is null.

## 3. Theme, sector and size moves, and velocity

### What history is stored

| What | Table | From | Per | Fields |
|---|---|---|---|---|
| themes, every 5 min in market hours | `theme_ticks_5m` (migration 028) | 20 Nov 2026 | theme | rank, score, median day % of members (vs previous close), RS vs SPY, % green |
| theme membership, once a day | `theme_membership_daily` (028) | 20 Nov 2026 | theme x symbol | core or not |
| regime, every 15 min | `regime_history` (028) | 20 Nov 2026 | slot | score, label, components |
| themes, hourly and daily close | `theme_snapshots` (older) | long before | theme | rank, score, median %; hourly rows are deleted at day end, daily_close rows kept |
| daily closes | `historical_bars` | ~330 calendar days | symbol | OHLCV |
| **sectors, cap-size buckets, SPY, every 5 min** | **`group_ticks_5m` (new, migration 030)** | **the deploy of this branch** | sector / size bucket | median day %, % green, names, rank in its kind; SPY's day % |

Sector and size history was **not** stored before this change, and no member-level intraday prices are stored at all.
So intraday sector / size velocity starts from the day this branch is deployed; a sector or size move between two
*dates* works now (from member daily closes). SPY's day % at a theme tick is derived exactly from the stored row
(median % - RS vs SPY = SPY's %, rounded to 0.01).

**Fixed with this change (snapshot.ts):** the 5-minute history used to be written by whichever refresh came first in a
slot, including a page's request for the 9:30 baseline or a size filter, whose numbers are not the whole theme's day
move. From this deploy on, history (themes and the new groups) is written only by default refreshes (previous-close
baseline, all sizes). Ticks stored before cannot be told apart.

The new sector / size writer sits next to the theme tick, under the same guard (`inMarketHours`, the same 5-minute
slot, once per slot, never throws, only `INSERT ... ON CONFLICT DO NOTHING`). It uses the live snapshot the theme tick
uses (every ticker the theme engine polls, ~650+ names) and the tickers table's `sector` and `market_cap_size` (the
bucket the size filter uses). Groups with fewer than 3 names are skipped. About 20 rows a slot, ~150 KB a day.

### `GET /api/market-condition/themes/move?from=&to=[&group=theme|sector|size][&ids=A,B]`

`from` / `to`: `YYYY-MM-DD` (that day's close, 16:00 New York) or `YYYY-MM-DDTHH:MM` (New York time; or with `Z` / an
offset). Two methods, named in `method`:

- **`member_closes`** (both ends are dates): each member's close-to-close % between the two sessions' daily bars; the
  median, the share of members up over the span and the member count are exact. Each date resolves to the nearest
  session at or before it (`offsetDays`). Themes use the stored membership of the first session (the earliest stored
  day, 20 Nov, when the span starts before it); sectors and sizes use the tickers table's current classes. Ranks at
  each end: the theme engine's rank at that session's last 5-minute read, or its `theme_snapshots` daily close before
  20 Nov. Up to 400 days, as far back as daily bars go.
- **`stored_ticks`** (an end has a time): each end is the nearest stored read at or before the instant
  (`offsetMinutes`). The move carries the group's stored median day %: `(1 + m_to) / (1 + m_from) - 1` within a session,
  chained through each session's last read across sessions. This is the move of the group's median, not the median of
  its members' own moves (members' intraday prices are not stored); breadth is the day's % green at each read. Refused
  if a trading day inside the span has no reads (names them). Up to 62 days.

Refusals: 400 for bad input or `from >= to` or `to` in the future; 404 when no history of that kind is stored; 422 when
the span starts before the stored history, or both ends land on the same read / session, with `available` (the range
that IS stored). Cached 5 minutes.

```json
{"group":"theme","method":"stored_ticks",
 "from":{"asked":"2026-11-24T10:02","resolved":"2026-11-24T15:00:00.000Z","offsetMinutes":2,"session":"2026-11-24"},
 "to":{"asked":"2026-11-24T10:30","resolved":"2026-11-24T15:30:00.000Z","offsetMinutes":0,"session":"2026-11-24"},
 "spyMovePct":0.1,
 "rows":[{"id":"SEMIS","name":"Semiconductors","movePct":1.1,"vsSpyPct":1,"rankByMove":1,"breadthUpPct":null,"dayBreadthFrom":55,"dayBreadthTo":70,
          "rankFrom":6,"rankTo":2,"rankChange":4,"members":null}],
 "available":{"from":"2026-11-20T14:30:00.000Z","to":"2026-11-24T15:30:00.000Z"},
 "notes":["stored_ticks: ...", "rankChange > 0 = climbed. ..."]}
```

In `member_closes` rows, `breadthUpPct` and `members` / `membersMissing` are filled and `dayBreadthFrom/To` are null.

### `GET /api/market-condition/themes/velocity?window=5|15|30|60[&at=][&group=..][&limit=..][&ids=..]`

Three stored reads in the same session: `end` (at or before `at`, default now), `start` (at or before end - window) and
`prevStart` (at or before start - window). Per group: `deltaPct` = `(1 + m_end) / (1 + m_start) - 1` of the median day
%, `perHourPct` = deltaPct x 60 / minutes, `rankChange` (> 0 climbed) and `rankPerHour`, `prevPerHourPct` and
`accelerationPerHour` (= perHourPct - prevPerHourPct). `rows` sorted by |perHourPct| (at most `limit`, default and max
50), `up` / `down`: the five fastest each way. Regular session only (reads exist 9:30-16:00 ET). When the market is
closed at `at` (weekend, holiday, before 9:30, after 16:00), `marketOpen` is false and the answer is the last session's
final windows, said so in `notes[0]`. A window longer than the session so far is `partial` with its real `minutes`.
Cached 60 seconds.

```json
{"group":"theme","windowMinutes":15,"at":"2026-11-24T15:31:00.000Z","marketOpen":true,"session":"2026-11-24",
 "end":"2026-11-24T15:30:00.000Z","start":"2026-11-24T15:15:00.000Z","prevStart":"2026-11-24T15:00:00.000Z","minutes":15,"prevMinutes":15,"partial":false,
 "rows":[{"id":"SEMIS","name":"Semiconductors","medianPct":1.5,"rank":2,"deltaPct":0.59,"perHourPct":2.38,"rankChange":2,"rankPerHour":8,
          "prevPerHourPct":1.99,"accelerationPerHour":0.39,"members":null}],
 "up":[...],"down":[...],"notes":["deltaPct: ...","regular session only ..."]}
```

Cost: move = 4-6 indexed queries (or one closes query of at most ~2 x members rows); velocity = 4 point lookups and 3
slot reads (~45 rows each). Both bounded by the number of groups (~40 themes, ~11 sectors, 5 sizes).

## 4. Stored BigIdea scan results

**Where they are:** `scan_sessions`. Every `POST /api/bigidea/scan` that gets to the end writes one row
(`server/bigidea/routes.ts`, the insert after the scan loop): `user_id`, `idea_id`, `scan_config` (the canvas nodes and
edges, and `universe`), `result_count`, **`result_symbols` (the matched tickers, in result order)**, `funnel_data`
(totalTickers, fetchFails, tooFewCandles, per-thought passed / failed / evaluated / skipped with the failed tickers, and
per-indicator diagnostic samples), `created_at`. Per user. Kept for good: nothing in the app deletes or prunes them.

Not stored: each match's price, name and which paths it passed (only in the scan's HTTP answer). The other tables:
`scan_tuning_history` holds the AI tuning rounds (config before / after, suggestions, counts); `scan_chart_ratings`
the user's thumbs up / down per symbol; `saved_scans` an old, unrelated filter store; `scanner_discoveries` is the
Signals scanner, not BigIdea.

**A gap found:** the app's two callers (`client/src/pages/BigIdeaPage.tsx`, `client/src/components/bigidea/
ValidationMode.tsx`) send no `ideaId`, so `idea_id` is null on their rows and a scan cannot be tied to a saved idea by
id; the thoughts' names are in `funnel_data.perThought`. The smallest fix: send `ideaId` in those two request bodies
(the server already stores it). Not done here (BigIdea's lane).

So no new table and no line in `server/bigidea/routes.ts` was needed: matched symbols are already stored.

`GET /api/bigidea/scan-results[?ideaId=N][&limit=1-50, default 20][&symbols=1-500 per scan, default 200]`, the
session user's newest scans first (new file `server/gateway-reads/scan-results.ts`; `server/bigidea/*` untouched):

```json
{"scans":[{"id":812,"ideaId":null,"ideaName":null,"universe":"sp500","createdAt":"2026-11-25T15:00:00.000Z","resultCount":3,
  "symbols":["NVDA","AMD","AVGO"],"symbolsTruncated":false,
  "funnel":{"totalTickers":500,"fetchFails":2,"tooFewCandles":1,"perThought":[{"name":"Base","passed":40,"failed":460,"evaluated":500,"skipped":0}]}}],
 "notes":["..."]}
```

The canvas criteria, the per-ticker failure lists and the per-indicator samples do not leave. A watchlist scan is sent
as a ticker list: its `universe` is null and the list itself is not stored. Not cached: one SELECT of at most 50 rows filtered by user (`scan_sessions` has no index on `user_id`; fine at its
size, worth one if it grows into the tens of thousands).

## 5. The rest of the reach spec's group 3

| Route | Decision | Why |
|---|---|---|
| `scanner/picks` | allowed | today's picks from memory (`getScannerPicks`); nothing to strip |
| `sentinel/ticker/:sym` | allowed | one Alpaca quote per read, plus one Finnhub profile the first time a name is seen (then stored in the tickers cache; deduped and rate-limited by `withFinnhubLimit`); one symbol per request; no account data |
| `market-condition/setups/scan-pool` | allowed | one COUNT query on `scan_pool` |
| `market-condition/setups/settings` | allowed | the grade thresholds (one small read) |
| `market-condition/universe`, `universe/:id` | allowed | the static theme lists |
| `sentinel/chart-data` | allowed, capped | Alpaca bars per request (the same as `stocks/:sym/history`); the gateway sets `lookbackDays` to at most 120 for daily (absent = 120, the route's own default is 750) and 5 / 10 / 20 days for 5 / 15 / 30-minute bars, and keeps one `timeframe` |
| `sentinel/rule-performance` | **left out** | `sentinel_rule_performance` has no user column: it pools every user's journal trades, so it is other users' data |
| `sentinel/sentiment/*` | **left out** | no model, but it calls Alpaca for SPY / sector bars and FMP's VIX history on a cold 30-minute cache, and the sector read can call Finnhub per symbol: paid vendor calls on demand |

Still never: Schwab orders and transactions, any `/ai/*` route, any new POST, `POST bigidea/scan`, the admin
`market-condition/history/:kind` dump.

## 6. Checks

`npm run test:gateway-reads` (earnings, theme history, scan results, gateway, access guard): fixed fixture cases, no
database, no network. `npm run check`: 674 errors on main before and after (none in these files).

## Must be checked live before merging

- `earnings/upcoming?days=7`: the liquidity CTE's cost on the real `historical_bars` (it reads ~45 days of bars for the
  window's symbols only); `?symbols=` for a followed, unfollowed and ETF symbol.
- `setups/vix`: whether FMP's quote carries `timestamp` (`reading.quoteTime`).
- `themes/move` both methods against what the Theme Tracker shows for the same days; `themes/velocity` in market hours.
- `group_ticks_5m` rows appear after the first market-hours slot following the deploy, ~20 per slot.
- `bigidea/scan-results` returns Don's rows only (`user_id` = the gateway user).
