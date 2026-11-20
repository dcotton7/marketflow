# Leader Shakeout rescan (20 Nov)
`POST /api/market-condition/setups/leader-shakeout/rescan?from=YYYY-MM-DD` (admin), or `scanLeaderShakeout(src, store, { rescan: true, rescanFrom })`.
Goes back over sessions already done and inserts the hits whose (symbol, date) is not stored, labelled source "backfill". Stored hits and run
rows are never written or changed (no run row is written in a rescan; hits already stored are skipped before insert). Run it after the bars are
backfilled, to catch names that had no bars at the time. Test: `npm run test:setups` (leader-shakeout.test.ts, in-memory store).
