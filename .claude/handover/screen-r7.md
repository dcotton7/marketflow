# Handover: R7, the screen route (`GET /api/market-condition/screen`)

Contract: Anima `docs/specs/quinn-market-desk.md` 4.4, extended for the Trading Buddy scan (`trading-buddy-scans.md`). Owner only;
on Anima's gateway allow-list (`/api/anima/market-condition/screen`).

## Parts
- `daily-summary.ts`: one summary row per symbol (theme + scan pool), table `ticker_daily_summary` + a small in-memory map
  (re-read every 6 h). Built by the daily bar check once fewer than 90% of the universe have a summary through the last finished
  session; one batch of 150 names' bars at a time. Holds: close/high/low/volume of the newest stored session, the session before
  (prev close/high/low), EMA10/20, SMA20/50/200, ADR20, base highs, 20-day average volume and dollar volume, volume expansion,
  sector, industry, market cap, cap size.
- `screen-core.ts`: pure query parsing, rows, filters, sort (the parameter list is in its header). `screen.ts`: collects the live
  theme rows from the snapshot (`getClusterMembers`, `getTickerSnapshot`, leaders) and joins the summary. Reads no bars, no Alpaca,
  no entry gauges, no database per request.
- A row says what it is: `source` "live" (`priceAsOf` = snapshot time) or "eod" (`priceAsOf` = the session date; the price is that
  close; `vwapPct` null). Pool-only names: `themeIds` [], `themeId` null, `rsRank`/`isLeader` null. Names whose summary is more than
  7 days behind the newest are left out (`staleExcluded` counts them).

## Choices to check
- `base_high` = highest high of the 30 sessions BEFORE the row's own day (live: through yesterday; eod: before its session).
- `volExp` is computed here (volume / 20-day average; live = today so far). The engine's own `volExp` in `getClusterMembers` is
  always 1 (no historical volumes are passed), so it is not used.
- `side=long` = changePct >= 0, `short` = <= 0 (4.4 names the parameter but not its meaning).
- `sort` descending by default, `dir=asc` flips; `rsRank` is best-first (ascending) by default. `symbols=` rows are returned wherever
  they rank; names outside the universe come back in `missing`, names the filters dropped in `unmatched`.
- Deviation from 4.4's "never touches the database": the summary map is loaded from the table once per 6 h, not per request.

## Tests / measured
`npm run test:screen`. Live data, read-only harness (1,038 theme names + 727 cloned as the pool): building the summaries = 263k bars
read in 28 s, peak +66 MB RSS once a day; the map held ~12 MB; one screen call 0.8 ms over 1,659 rows.
