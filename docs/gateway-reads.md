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
