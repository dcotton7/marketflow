# MarketFlow Tester playbook

Role: run checks, say pass or fail. No code edits, no deploys, no Render/key/data changes. Hand-off format is in
`H:\AI LLM\Anima\docs\dev-team.md`. Temp output goes under `E:\Temp\marketflow-tester`, cleaned after.

## Sync (never reset or stash)
`git fetch` then `git merge origin/main --no-edit`; then `git checkout <commit>` only in a clean tree, else read-only `git show`.

## What tests exist
There is no `npm test`. Tests are 61 standalone `*.test.ts` files run one at a time with `npx tsx <file>`; exit code 0 = pass.
Four are wired as scripts: `npm run test:start-here-smoke`, `test:tos-embed`, `test:db-watchdog`, `test:watchlist-panel`.
Areas covered: alerts, bridge (Discord, ToS), middleware (Anima embed/gateway, lockout), research, scanner, schwab,
sentinel, market-leaders, shared chart/scanner math, a few client libs. No tests for most routes, UI pages, or the DB layer.
None of the tests need a key or live data (baseline 19 Nov: all pass).

## Commands
- Targeted: `npx tsx <path to .test.ts>` for each file the change touches (and its siblings in the same folder).
- Full run (about 7 min, run in background, 120 s cap per file):
  `git ls-files | grep -E '\.test\.ts$' | while read f; do timeout 120 npx tsx "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
- Type check: `npx tsc --noEmit` (about 40 s). Baseline has many old errors (TradeJournal, JournalCashSetupCard, SaveEnrichModelDialog, uploads/routes and more).
  Judge by the touched files only: `npx tsc --noEmit | grep -E "<touched file names>"` must print nothing.
- Build: `npm run build` (what Render runs). Run it when the change touches build config, imports or `package.json`.
- Flaky on baseline: `server/bridge/discord-bridge-twin.test.ts` failed once in the full run and passed on rerun; rerun before calling it a fail.

## Beyond the tests
UI changes need a look: `npm run dev` (needs `.env` with `DATABASE_URL`; port is in the dev log) and the built-in browser.
Say "UI not checked" in PASSED if you did not look. Anything that needs Alpaca, OpenAI, Schwab or the live DB stays
unchecked unless Don gave a key; say so.

## Deploy path (the Deploy Master owns this)
Render web service `stock-pattern-stream` (render.yaml; plan standard; build `npm install && npm run build`, start `npm run start`),
deployed from GitHub `main`. DEPLOY.md says auto-deploy "if enabled": I could not confirm the setting, Deploy Master must check
the Render dashboard. Also a cron `refresh-daily-bars` (weekdays 21:30 UTC). Live URL: `https://stock-pattern-stream.onrender.com` (per DEPLOY.md; confirm).
Health: `GET /api/health` returns 200 `{ok:true,db:"ok"}`, 503 if DB unreachable. Extra: `/api/health/memory`, `/api/health/circuits`, `/api/health/discord`.
Memory limit is a known concern (`HEAP_LIMIT_MB` 1536, `RSS_BUDGET_MB` 2048).
