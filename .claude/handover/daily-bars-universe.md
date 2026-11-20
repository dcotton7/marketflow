# Handover: daily bars for the whole universe + backfill (branch `claude/great-booth-fbb87a`, 20 Nov 2026)

## Cause (measured read-only on the live DB)
`daily-bar-refresh.ts` refreshed only `getAllUniverseTickers()` = the static theme lists (657 names). The tickers table adds
~434 more names that no job touched: 617 of the 657 are fresh, 434 tickers-table-only names are stale or have no bar. It was
not a cap, a rate limit or a failed batch. Two smaller faults found on the way: the run was alphabetical and a memory/night
abort restarted at "A" the next time (6 h later); and `.catch(() => [])` hid vendor errors, including the 401 check.

## What changed
- `server/data-layer/bar-universe.ts`: one universe = static lists + tickers table - `data/delisted-symbols.json`;
  `expectedLastSession` (last finished session, holiday aware); `splitStale` (stalest first).
- `daily-bar-refresh.ts`: uses that universe; "stale" = newest bar older than the last finished session (was: 3 days);
  stalest first; check every 30 min (was 6 h; a cheap aggregate when all is fresh); night/pressure lines logged once per day;
  vendor errors no longer swallowed; `lastRun` (counts, names with no bars, `needsBackfill`) added to
  `getDailyBarRefreshStatus()`. It still only fetches the last 10 days, so a name more than 10 days behind keeps a hole: the
  backfill fills it. MA recalculation now covers only the names actually processed.
- `server/data-layer/bar-backfill.ts` + `server/scripts/backfillMissingBars.ts`: the backfill.
- Test: `npm run test:bars` (`server/data-layer/bar-backfill.test.ts`, no DB, no network).

## Backfill
```
npx tsx server/scripts/backfillMissingBars.ts --dry-run     # counts and the target list, no vendor call, no write
npx tsx server/scripts/backfillMissingBars.ts               # real run
```
Targets = universe names with no bar on the latest stored session. History from 2024-06-01 (`--from=`). One vendor request at a
time, 400 ms apart (~150/min, Alpaca allows 200), one symbol in memory at a time (~620 bars), inserts of 500 rows with
`ON CONFLICT (symbol, bar_date) DO NOTHING`: nothing is changed or deleted, a second run inserts 0. The still-developing
session bar is not stored. Names the vendor cannot serve are listed with the reason in the final JSON report.
After inserting it recalculates `ticker_ma` for the names it filled (`--no-ma` to skip).
Dry run on my base (before commit 2cdc2dd's retirements): universe 1,055, 617 with the latest bar, **438 targets** (68 no bars at
all, 370 stopped). With 2cdc2dd merged expect about 421-425 (retired names leave the file/lists). Vendor check (read-only):
AAT and BF.B both return 621 bars, 2024-06-03 to 2026-11-19, i.e. the same depth as current names.
Expected after the run: universe names with a bar on the latest session = universe size minus the names listed as not served.

## Notes
- Build order: 2cdc2dd (`claude/market-cap-followup`) is not on main in my base; my change reads the retired file at run time, so it
  works either side of it; run the dry run after that commit is live to get the final count.
- Memory: the daily job holds one batch of 5 symbols x 10 bars; the backfill one symbol at a time. No whole-universe load; the
  only universe-wide reads are two aggregate queries (one row per symbol).
- Not changed: `scanner/index.ts` five-day levels still use the static list only (separate job).
