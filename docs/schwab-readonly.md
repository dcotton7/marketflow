# Schwab read-only link (spec)

Don, 10 Nov 2026: "build the link for read only so I can make alerts and have real time data".

**Read only.** MarketFlow reads Don's Schwab accounts, positions, balances, orders, transactions and market data. It
never places, changes or cancels an order: the client has no write method at all, the only POST anywhere in
`server/schwab/` is the OAuth token exchange, and `server/schwab/schwab.test.ts` fails the build if that changes.

Code: `server/schwab/`. Settings card: `client/src/components/SchwabCard.tsx`. Flag: `SCHWAB_ENABLED`.

## 1. Sign-in (OAuth)

- Don registers an app at developer.schwab.com (Trader API - Individual, both "Accounts and Trading Production"
  and "Market Data Production"). He enters the keys in Render and his local `.env` himself; no session reads them.
- Env var names (values never in code or docs):
  - `SCHWAB_ENABLED=1`: the feature flag. Unset: no routes do anything, nothing starts, the card is hidden.
  - `SCHWAB_APP_KEY`: the app's key (OAuth client id).
  - `SCHWAB_APP_SECRET`: the app's secret.
  - `SCHWAB_CALLBACK_URL`: exactly the callback registered with Schwab, online
    `https://marketflow-hrxh.onrender.com/api/schwab/callback`.
  - `SCHWAB_TOKEN_KEY` (optional): the key that encrypts stored tokens. Unset, it is derived (HKDF) from the app
    secret, so a new secret means signing in again.
  - `SCHWAB_STREAM_MAX_SYMBOLS` (optional, default 200): the stream's symbol cap (section 3).
- Flow: Settings, **Connect Schwab** opens `GET /api/schwab/connect`, which redirects to
  `https://api.schwabapi.com/v1/oauth/authorize?client_id=…&redirect_uri=…&state=…`. Don signs in at Schwab and picks
  the accounts. Schwab redirects to `/api/schwab/callback?code=…&state=…`; MarketFlow checks the state (an HMAC of
  his user id and time, valid 10 minutes, so any instance can check it), posts the code to
  `https://api.schwabapi.com/v1/oauth/token` (Basic auth with key:secret, `grant_type=authorization_code`) and sends
  him back to Settings. The callback must be HTTPS: Render gives that. Locally there is no HTTPS, so Don connects
  online; LOCAL and Live share one database, so both use the same tokens.
- Tokens are stored in `schwab_connection` (one row per user), encrypted with AES-256-GCM: access token, refresh
  token, their expiry times, the last error. Never logged, never returned by any route.
- The access token lasts 30 minutes and is refreshed automatically when less than 5 minutes are left
  (`grant_type=refresh_token`). Before refreshing, the row is read again, so when the other instance already
  refreshed, its token is used instead. One refresh at a time per instance.
- The refresh token lasts 7 days from sign-in and refreshing does not extend it. States:
  - `connected`;
  - `expiring`: under 24 hours left. Settings and `/api/health/schwab` show "Schwab sign-in expires in N hours —
    sign in again to keep it", and the stream keeps running;
  - `expired`: the 7 days passed, or Schwab refused the refresh (`invalid_grant`, 400/401). Everything Schwab stops,
    alerts fall back to the old price source, and Settings shows "Schwab disconnected — sign in again" with one
    **Sign in again** button (the same Connect flow);
  - `disconnected`: never connected, or Don pressed Disconnect (the row's tokens are deleted).

## 2. Endpoints used (all GET)

Trader API, `https://api.schwabapi.com/trader/v1`:
- `/accounts/accountNumbers`: account numbers and their hash values (the hash is used in every other path);
- `/accounts?fields=positions`: positions and balances for every linked account;
- `/accounts/{hash}/orders?fromEnteredTime&toEnteredTime`: order history (read);
- `/accounts/{hash}/transactions?startDate&endDate&types`: transactions (read);
- `/userPreference`: the streamer's address and ids.

Market Data, `https://api.schwabapi.com/marketdata/v1`:
- `/quotes?symbols=…`: quotes (each carries a `realtime` flag, shown in status);
- `/pricehistory?symbol&periodType&frequencyType&frequency&startDate&endDate`: daily and minute candles.

Streamer (WebSocket, address from `/userPreference` `streamerInfo[0].streamerSocketUrl`): `ADMIN LOGIN` with the bare
access token, then `LEVELONE_EQUITIES` (bid, ask, last, open, high, low, close, volume, net change, mark, quote and
trade times) and `CHART_EQUITY` (one-minute OHLCV bars) for the subscribed symbols.

## 3. Rate limits, backoff, stream cap

- REST: a client-side budget of 100 requests a minute (under the 120 a minute commonly reported; unconfirmed, see
  limits). A 429 or 5xx is retried 3 times with exponential backoff (1 s, 2 s, 4 s, or `Retry-After` when given);
  a 401 refreshes the token once and retries.
- Stream: one connection per user, held by one MarketFlow instance: a Postgres advisory lock picks the instance
  (as `worker-lock.ts` does for alerts); the other reports `standby`. Reconnect with backoff 1 s doubling to 60 s,
  logging in again with a fresh token and resubscribing the same symbols. A heartbeat gap of 60 s counts as a drop.
- Subscriptions are shared: each caller names its set (`alerts`: open positions, the starred list, SPY and QQQ;
  `ui`: nothing yet), the union is subscribed, capped at `SCHWAB_STREAM_MAX_SYMBOLS` in caller order (positions
  first). Symbols over the cap and everything else keep the existing quotes (Alpaca snapshots), unchanged.

## 4. Alerts

The running alert engine (`server/alerts/position-worker.ts`, 30 s cycles in market hours) takes its prices from
`getAlertQuote(symbol)`: a Schwab stream tick under 15 s old when Schwab is connected and streaming, otherwise the
current `getQuote` (Alpaca). The rules, dedupe and feed to Anima are unchanged. Each cycle sets the `alerts`
subscription to the symbols it watches. (The older user-alert poller stays paused, as today.)

## 5. Positions into the portfolio lists

- The sync writes to one list only, "Schwab positions" (a portfolio list), created on the first sync; its id is
  kept on the connection row. It never writes to, or deletes from, any other list.
- Each equity or ETF position (all linked accounts, summed by symbol, average price weighted by quantity) becomes a
  row: shares, entry (Schwab's average price), long or short. Options, cash and money funds are skipped.
- Rows the sync created are recorded in `schwab_synced_rows`. When Schwab no longer shows the position, only such a
  row is removed. A row Don added to the list himself is never deleted or changed. His stop, target and notes on a
  synced row are kept; the sync updates only shares, entry and side.
- A position he already tracks in another portfolio list (same symbol and side) is not added again, so the
  position alerts don't fire twice; the card lists those as "already in your lists".
- Runs after sign-in, every 5 minutes in market hours, every 30 minutes otherwise, and from **Sync now**.

## 6. Status and the Settings card

`GET /api/health/schwab` (public, no account data): `{ enabled, configured, state, message, accessExpiresAt,
refreshExpiresAt, refreshHoursLeft, stream: { state, symbols, lastMessageAt, reconnects }, lastQuoteAgeSec,
realtime }`. `stream.state` is `off | standby | connecting | streaming | reconnecting`.
`GET /api/schwab/status` (owner) is the same plus the sync list and last sync. The Settings card shows Connect /
Sign in again, the state, the sign-in expiry, the stream and last-quote age, Sync now and Disconnect.

## 7. Anima

The gateway (`server/middleware/animaGateway.ts`) allows GET `/api/schwab/positions`, `/api/schwab/balances`,
`/api/schwab/quotes?symbols=…` and `/api/schwab/status`. No orders, transactions or writes.

## Limits checked against Schwab's docs (10 Nov 2026)

Schwab's API pages (developer.schwab.com) need a login, so most numbers come from the client libraries built on them.
- Access token 30 minutes, refresh token 7 days, not extended by refreshing: confirmed by several sources
  ([schwab-client-js](https://github.com/slimandslam/schwab-client-js/blob/main/docs/SchwabConfig.md),
  [schwabr](https://archive.linux.duke.edu/cran/web/packages/schwabr/readme/README.html)).
- OAuth URLs, the streamer LOGIN/SUBS message shapes and field numbers, bare token in `Authorization`: from
  [schwab-py streaming.py](https://github.com/alexgolec/schwab-py/blob/main/schwab/streaming.py) and
  [auth.py](https://github.com/alexgolec/schwab-py/blob/main/schwab/auth.py). The callback must match the
  registered URL exactly.
- **Unconfirmed:** 120 requests a minute (third-party write-ups only); one streamer connection per user (assumed,
  designed for); the symbols-per-subscription cap (default 200 is a guess, an env var); how far back minute
  history goes (not stated; MarketFlow keeps using its own intraday bars for history); real-time vs delayed quotes
  for his account (not assumed: read from each quote's `realtime` flag and shown in status).
