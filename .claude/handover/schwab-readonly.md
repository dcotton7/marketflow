# Handover: Schwab read-only link (branch `anima/schwab-readonly`)

Spec: `docs/schwab-readonly.md` (Don approved the read-only link in chat, 10 Nov 2026). Not merged; the admin merges
on Don's OK. MarketFlow's Render service auto-deploys `main`, so only the admin merges.

## What changed
- `server/schwab/`: `config.ts` (env names, AES-GCM token encryption, signed OAuth state), `store.ts` (tables
  `schwab_connection`, `schwab_synced_rows`, created at boot only when the flag is on), `auth.ts` (sign-in, refresh
  at <5 min left, 7-day expiry, `expiring` <24 h, `expired` = "Schwab disconnected — sign in again"), `rest.ts`
  (GET-only client, 100/min budget, backoff on 429/5xx, one refresh on 401; positions/balances/quotes parsers),
  `streamer.ts` (LOGIN, LEVELONE_EQUITIES + CHART_EQUITY, union of callers' symbols capped, reconnect 1 s→60 s,
  60 s silence = drop), `quote-cache.ts`, `alert-price.ts`, `sync.ts`, `status.ts`, `service.ts` (boot wiring,
  stream advisory lock 74_337_002 so only one of LOCAL/Live streams), `routes.ts`, `schwab.test.ts`.
- `server/alerts/position-worker.ts`: prices from `getAlertQuote` (Schwab tick <15 s old, else the old getQuote);
  each cycle names its symbols to the stream (positions + SPY/QQQ first, then the starred list).
- `server/middleware/dataAccess.ts`: `/api/schwab/*` owner only; `/api/schwab/callback` public (the HMAC state
  names the user). `/api/health/schwab` is public under the existing health rule.
- `server/middleware/animaGateway.ts`: GET `/api/schwab/(positions|balances|quotes|status)` for Anima.
- `client/src/components/SchwabCard.tsx` on the Settings page (hidden while the flag is off).

## Tests
`npx tsx server/schwab/schwab.test.ts` covers all 7 fixed cases with mocked replies. Also green: animaGateway,
dataAccess, position-alerts, evaluator-daily-order. `tsc`: no errors in touched files (the Settings page's
`systemSettings` error was already on main).

## Anima side (not edited; for the Anima coding session)
`anima/marketflow.py` would need read helpers over the gateway, same token/headers as the others:
- `GET /api/anima/schwab/status` → `{state, message, refreshHoursLeft, stream:{state,...}, lastQuoteAgeSec, realtime}`;
  Quinn should say "Schwab is disconnected, sign in again in MarketFlow Settings" when `state` is `expired`.
- `GET /api/anima/schwab/positions` → `{positions:[{symbol, side, shares, averagePrice, marketValue, dayPnl, accounts}]}`
  (accounts masked to the last 4 digits).
- `GET /api/anima/schwab/balances` → `{balances:[{account, type, liquidationValue, cashBalance, buyingPower, ...}]}`.
- `GET /api/anima/schwab/quotes?symbols=NVDA,SPY` (up to 100) → `{quotes:[{symbol,last,bid,ask,...,realtime}]}`.
- A 404 from `/api/anima/schwab/*` (other than status) means the link is off; 409 means signed out.
Positions also reach Quinn as before: synced rows land in the "Schwab positions" portfolio list, so
`/api/positions/snapshot` and the alert feed include them with no Anima change.

## Left / gotchas
- Unconfirmed numbers (in the spec): 120 req/min, one stream per user, symbol cap (env `SCHWAB_STREAM_MAX_SYMBOLS`,
  default 200), minute-history depth, real-time entitlement (read at runtime from the `realtime` flag).
- No live call was made: field names follow Schwab's published schema and schwab-py; the first real sign-in should
  be checked against `/api/health/schwab` and `/api/schwab/positions`.
- Connect online (HTTPS callback). LOCAL shares the database, so it uses the same tokens.
- If a position is already in one of Don's own portfolio lists, the sync skips it (no double alerts).
- The older user-alert poller (`server/alerts/poller.ts`) is still paused; only the position worker uses Schwab.
- Worktree `E:\Stock-Pattern-Stream-wt-schwab` has a `node_modules` junction: `rmdir node_modules` before
  `git worktree remove`.
