# Handover: pool safe to re-land (job guard), 20 Nov evening

The service's RSS rose by ~1 GB (heap flat) minutes after the scan pool went live (6e230e3), and was rolled back. THE GROWTH IS NOT YET
EXPLAINED: locally the bar job over 1,752 names, two cycles, showed no growth (stubbed writes; real writes into temp tables ran 4 min flat).
This commit does not claim a fix. It makes the next run safe and readable; the first live run is the measurement.

## What it adds (server/infra/job-guard.ts)
1. One data job at a time: the daily bar job (every 30-min check), the scan pool refresh (weekly tick and the admin route) and the backfill
   script share an in-process lock, and a Postgres advisory lock (key 74337101) so the backfill (own process) and the service cannot overlap.
   A skipped start is logged (`[JobGuard] X not started: Y is running`); a skipped bar check retries at the next 30-min check; the admin
   refresh answers 409.
2. Memory guard: between 100-name batches and 50-name MA batches the job reads RSS; above `JOB_RSS_LIMIT_MB` (default 1300) it stops cleanly
   (`STOPPED at batch 7, name 700 of 1752: rss ...`) and no data job restarts until the next ET day (`guardTrippedToday`).
3. Phase lines with RSS, heap, external: `[DailyBarRefresh] refresh start / batch k/n / MA phase start|end / refresh end`, `[ScanPool] refresh start /
   screener answered / refresh end`, `[Backfill] start / bars done / end`.
4. Native-holder review without a measurement: the vendor answer is dropped after each batch (`fetched = undefined`); writes are one multi-row
   upsert per batch (chunks of 500) instead of one statement per name; the MA phase reads 50 names per query (window query, 250 closes each)
   and writes one upsert per 50, instead of 2 statements per name, and only for theme names (scan-pool-only names do not use ticker_ma);
   unread response bodies of failed FMP calls are cancelled (scan pool screener, VIX). No prepared statements are named (drizzle node-postgres
   sends unnamed queries), so none accumulate on a connection. Not found: a structure kept across batches.

## Watch on the first live run
`[Memory]` lines and the phase lines above; if RSS passes 1,300 the job stops and says where. Kill switches: SCAN_POOL=off (pool out of bars and
refresh), JOB_RSS_LIMIT_MB (lower it to be stricter).

## Manual bar cycle (21 Nov)
`POST /api/market-condition/bars/refresh` (admin session): starts one bar cycle now, in the background (202 `{started:true,status}`), ignoring
night mode for that run only; same lock, RSS guard, phase lines, summary build. 409 `{started:false,reason}` when another data job runs, the guard
stopped one today, or memory pressure is already high. Progress: service log lines `[DailyBarRefresh] ... rss ...` and `Manual cycle started/finished`.
Code: `startManualBarCycle` in data-layer/daily-bar-refresh.ts. Test: `npm run test:guard`.
