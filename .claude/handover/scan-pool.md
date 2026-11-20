# Handover: the scan pool (job 3; Don 20 Nov 2026: "expand the universe to cover them all", "volume to be 50m+")

Pool = US-listed (NYSE, NASDAQ) common stocks with market cap >= $1B, price >= $6, average traded value (avg volume x price)
>= $50M a day, from FMP `/stable/company-screener` (the key in use). Dry run on 20 Nov: 1,167 qualify, 663 already in the
theme universe, 504 new.

## Design
- `server/data-layer/scan-pool.ts`: table `scan_pool` (symbol, name, exchange, sector, industry, market_cap, price,
  avg_dollar_vol, in_universe, active, first_seen, last_qualified, inactive_since). Separate from `tickers`, so pool names are in no
  theme, not in the 1-minute polling (that list is the static theme universe), and cannot move theme or regime readings.
- Weekly refresh: a check every 6 h runs it when the last refresh is over 7 days old (first check 5 min after start).
  Admin: `POST /api/market-condition/setups/scan-pool/refresh?dryRun=1` (plan and counts, writes nothing), `GET .../scan-pool`.
- Nothing deleted: a name that falls out is marked inactive (bars kept, no longer refreshed); back above the floor it is reactivated.
  Hysteresis: in at the full floor, out only below 80% of each floor. A partial vendor answer (< 600 rows, or more than half the
  active pool vanishing) deactivates nothing.
- Bars: `loadBarUniverse` = theme universe + active pool - retired. The daily bar job now asks Alpaca for 100 names per call
  (multi-symbol endpoint; ~16 calls for ~1,550 names, was one call per name) and writes each name's rows in one statement; a
  failed batch is retried at the next 30-min check and a 401 still flags the key. The backfill script takes the same list
  (`--theme-only` leaves the pool out; its dry run prints `ofWhichScanPoolOnly`).
- Kill switch: env `SCAN_POOL=off` -> bars and refresh go back to the theme universe alone.
- Tests: `npm run test:pool`.

## Who reads the pool, who does not
See the hand-off line. Readers find pool names because they read every symbol in `historical_bars` (no code change in them).

## Measured memory (20 Nov, live DB read-only, local process; harness cloned 503 extra symbols from real bars)
Daily run of each reader over every symbol in historical_bars (2,622 today, 3,125 with 503 more), read in batches of 150:
- Leader Shakeout (newest day): peak RSS +35 MB over baseline today, +32 MB with 503 more; heap +17 -> +19 MB. 6 s -> 7 s.
- Market card: heap peak +78 MB today -> +83 MB with 503 more (RSS peak +100 MB, noisy: GC timing); about +19% symbols, +6% heap.
Neither reader holds every bar at once (batch of 150 names, then released; only hit rows and theme members' closes are kept).
So the pool adds about 5 MB of working memory to the setup jobs; storage is the real cost (+~88 MB on 188 MB in the table).
Not measured: the SEC and earnings jobs (they walk `followed()` = every symbol with bars + tickers; +~500 names of lookups).
