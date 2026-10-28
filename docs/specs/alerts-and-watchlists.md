# Market alerts from Quinn + watchlist panels in Anima — build plan

Date: 2026-10-28. Repos: MarketFlow (`E:\Stock-Pattern-Stream`, auto-deploys from `main`) and Anima (`H:\AI LLM\Anima`).

## What already exists (reuse, don't rebuild)

**Watchlists.** `watchlists` has `isDefault` (the yellow star in `WatchlistModal.tsx`, one per user, set by
`POST /api/sentinel/watchlists/:id/set-default`) and `isPortfolio` (the briefcase toggle). So "starred" exists: the
starred list = `isDefault`. Items (`sentinel_watchlist`) have `targetEntry` (used as entry price for portfolio lists,
see `ChartPreviewWidget.tsx`), `stopPlan`, `targetPlan`, `alertPrice`, `createdAt`. **No share count and no entry
date.** "My positions" is a row in the database (not checked); it should be the list with `isPortfolio = true`.

**Indicators on the Anima chart panels.** Charts 1–4 (`mfcharts1-4`) frame `/embed/charts` → `EmbedChartsPage.tsx` →
`MiniChart.tsx`. All of this math runs **in the browser**:
- `MiniChart.tsx`: `calculateSMA`, `calculateEMA`, `calculateAtr` (14-day simple average of true range),
  `calculateSessionVwap` (typical price × volume, resets each ET session), EMA 6/20 on intraday, and the info box
  "ATRx from 50MA" = `(price − SMA50d) / ATR14` (dollars over dollars), plus % from 200DMA and % from entry.
- `client/src/lib/mini-chart-indicators.ts`: a second copy of SMA/EMA/session VWAP, plus the user MA overlays from
  `/api/sentinel/ma-settings` (any period, SMA or EMA — this is where 5/10/20/50 lines come from).
- RSI and MACD are **not** drawn on these charts.

Server-side math that already exists:
- `server/shared/ma-math.ts` (SMA/EMA, used by the alert evaluator); stored daily `ema10d, ema20d, sma20d, sma50d,
  sma200d, adr20` (`data-layer/moving-averages.ts`) with intraday session adjustment (`session-adjusted-ma.ts`).
- `shared/entry-gauge.ts`: VWAP gauge and 5-min EMA 6/20 gauge — already shared by client and server.
- `server/sentinel/chartDataEngine.ts`: ema5/10, sma21/50/200, session VWAP, anchored VWAP (Sentinel charts).
- `server/bigidea/indicators.ts`: ATR, ATR %, RSI, MACD, Opening Range Breakout (ITD-1), VWAP Position (ITD-2), Gap,
  Breakout Detection, base detection, Price Crosses MA, Intraday Cross of Daily MA.
- Quotes carry Alpaca's `vwap`.

**Alerts.** A full engine exists: `user_alerts`, `alert_events`, `alert_deliveries`, `alert_symbol_states`
(`shared/schema.ts`), `server/alerts/evaluator.ts`, `poller.ts` (every 30 s in market hours, 2 min after hours),
`routes.ts` (`GET /api/alerts/events` etc.), channels `in_app | email | sms` with **Twilio already wired**
(`server/messages/providers/twilio.ts`). Rule rows support price vs SMA/EMA/VWAP/trade entry/stop/target — not ATR
extension, % from entry, or close-below-MA-by-regime.

**Anima.** `anima/diary.py` fires reminders as "initiative" turns with `[choices: ...]` and the Lab bell;
`anima/marketflow.py` `fetch()` calls `GET /api/anima/<path>`; panels `mfwatch` (`/embed/watchlist`, small,
read-only), `mfscanner`, `mfdiscord`, `mfcharts1-4` in `lab/lab.js` (`MF_PAGES`, panel list); Quinn opens them via
`architect.PANELS` (`"watchlist": "mfwatch"`).

## Schwab paste: does it work today? No.

`WatchlistModal.tsx` `handleAddTickers` (lines 584–592) uses a one-line `<input>`, splits on spaces/commas, strips a
leading `$`, and keeps any word matching `^[A-Z]{1,5}$`. There is no paste handler. A one-line `<input>` drops or
flattens line breaks, so a multi-row paste does not arrive as rows. On a Schwab row such as
`NVDA  NVIDIA CORP  $181.20  +2.31  100  $18,120.00`, it adds NVDA, but also **CORP**. Words like INC, CO, CL, A, ETF
get added as tickers. Headers such as Price, Qty, Last pass the filter. `BRK/B` and `BRK.B` are dropped. An option
`NVDA 01/16/2026 200.00 C` adds NVDA and **C (Citigroup)**.

Schwab copy formats the parser must handle:
- **Schwab.com Positions/Watchlist table (select + copy):** tab-separated rows. A header row includes `Symbol`,
  `Description`, `Qty`/`Quantity`, `Price`, `Price Chng $/%`, `Mkt Val`, `Cost Basis`, `Gain $/%`. Cells contain `$`,
  thousands commas, `%`, `--`, and parentheses or minus signs for negatives. Footer rows include
  `Cash & Cash Investments`, `Account Total`, and `Positions Total`.
- **Schwab CSV export:** a title line (`Positions for account ... as of ...`), a blank line, then a quoted
  comma-separated header and rows.
- **thinkorswim watchlist copy:** tab-separated with the symbol first. Options look like `.NVDA260116C200`.
- Share classes appear as `BRK/B` or `BRK B`; Alpaca uses `BRK.B`. Options on Schwab.com look like
  `NVDA 01/16/2026 200.00 C`.
- Plain lists such as `AAPL, MSFT` or one ticker per line.

Parser rules (`shared/ticker-paste.ts`, unit-tested):
- Read the clipboard text on paste into a `<textarea>`. Split into rows on newlines, then into cells by tab. If there
  are no tabs, use comma-separated parsing with quotes. If that fails, split on spaces.
- If a `Symbol` header exists, use that column. Otherwise use the first cell.
- Skip header, footer, and cash rows.
- Uppercase the symbol, strip `$` and whitespace, and change `/`, a space, or `-` before a share class to `.`.
- Map options to their underlying symbol and mark them in the preview.
- Validate with `^[A-Z]{1,5}(\.[A-Z])?$` and remove duplicates.
- Show a preview like "23 found, 4 skipped (why)" before adding.
- When pasting into the positions list, also read Qty and Cost Basis/Avg Price to fill shares and entry price.

## Phases

**Phase 1 — One copy of the chart math (MarketFlow).**
- Move `calculateSMA`/`EMA`/`Atr`/`SessionVwap` series functions and the ATRx-from-50 formula from `MiniChart.tsx`
  and `lib/mini-chart-indicators.ts` into `shared/chart-indicators.ts`.
- Point both client files at it. `server/alerts/*` imports the same functions.
- No new math. Daily 5DMA, which isn't stored, is the same SMA over `getDailyBars`.
- *Done when:* a fixture-bars test shows identical numbers before and after the move; charts look unchanged; the
  server can compute `extensionAtr` for a symbol.

**Phase 2 — Position data (MarketFlow).**
- Add nullable `shares` and `entry_date` to `sentinel_watchlist` (`shared/schema.ts`), with an ensure-script like
  `server/scripts/ensureWatchlistPortfolioColumn.ts` and the field in `server/sentinel/routes.ts` add/patch.
- Add edit cells in `WatchlistConfigurableTable.tsx` / `watchlist-column-profile.ts`.
- Positions = items in `isPortfolio` lists. Watchlist alerts = items in the starred (`isDefault`) list.
- *Done when:* Don can set entry, shares, and date on each position, and an API read returns them.

**Phase 3 — Rule engine and alert feed (MarketFlow).**
- Add `server/alerts/position-rules.ts`, called from the existing `poller.ts` cycle. Rules per position:
  - **Hard stop:** stop = entry × 0.95. *Approaching* when last ≤ stop × 1.01; *breach* when last ≤ stop.
  - **Trim:** `extensionAtr ≥ 7` using the chart's formula. Suggest trim % from VIX on a 5–25% ladder.
  - **Trail:** at the daily close, close < trailing MA. Use the 5DMA when extension ≥ 5, the 20DMA when profit
    ≥ 20% and extension < 3, otherwise the 10DMA (thresholds are open questions).
- Write rows to a new table `position_alerts`: `id, userId, symbol, rule, level, message, payload jsonb, dedupeKey
  unique, createdAt`. Dedupe means one alert per symbol, rule, and level per day; a breach also fires after
  approaching.
- New route `GET /api/alerts/feed?after=<id>` in `server/alerts/routes.ts`. It merges `position_alerts` with existing
  `alert_events`.
- Add `^/api/alerts/feed$` to `ALLOWED` in `server/middleware/animaGateway.ts` (+ test). Mark it `auth` in
  `dataAccess.ts` (+ test).
- *Done when:* unit tests cover each rule on fixture bars, including no double-fires, and the gateway returns new
  alerts after a cursor and returns 403 for other `/api/alerts` paths.

**Phase 4 — Quinn delivers them (Anima).**
- New `anima/market_alerts.py`: a thread started next to `diary.schedule` in `anima/service.py`. It polls
  `marketflow.fetch("alerts/feed?after=N")` every 20 s in market hours and every few minutes otherwise, and stores
  the cursor.
- Each alert becomes a diary entry of kind `market`. `diary.py` gets choices per kind:
  `[choices: Trimmed | Snooze 30 | Ignore]`, or `Sold | Snooze | Ignore` for stops, plus `act()` handling. Market
  alerts skip the 18:30–9:00 quiet hours.
- The bell and list in `lab/lab.js` show them. The message is written by code: rule, numbers, and suggested trim %.
- *Done when:* a test alert in MarketFlow appears in Quinn's chat with buttons and on the bell within 30 s; Snooze
  re-fires; Ignore and Trimmed stop it.

**Phase 5 — Detailed watchlist panel and Schwab paste.**
- MarketFlow:
  - Add `shared/ticker-paste.ts` and its tests.
  - Add a textarea and preview in `WatchlistModal.tsx`.
  - New `client/src/pages/EmbedWatchlistFullPage.tsx`, reusing `WatchlistConfigurableTable` and the column profile,
    with route `/embed/watchlist-full` in `App.tsx`.
  - New `POST /api/sentinel/watchlist/bulk-add` (JSON) in `server/sentinel/routes.ts`.
  - Allow only that POST in `EMBED_POSTS` in `server/middleware/animaEmbed.ts`, because the embed cookie is read-only
    today.
- Anima:
  - Add `mfwatchfull: "/embed/watchlist-full"` to `MF_PAGES` and a panel definition titled "Full watchlist" in
    `lab/lab.js`.
  - In `anima/architect.py` `PANELS`, add `"fullwatchlist": "mfwatchfull"`, rename the small one "Small watchlist",
    and add aliases.
- Wording:
  - "full / detail(ed) / big / comprehensive watchlist" → full.
  - "small / little / mini / live watchlist" → small.
  - **"Watch" vs "watch":** voice transcripts don't keep capital letters reliably, and a sentence-opening "Watch" is
    always capitalized. So capital *Watch* means the full list only in typed text and not as the first word ("open
    Watch"). Everything else that is bare ("open watch", "watch", "watchlist") opens the small list, and Quinn adds
    "say 'full watchlist' for the detailed one."
  - "watch" followed by her name, or with no open/show verb ("watch NVDA"), never opens a panel. The "Watch {name}"
    panel group already uses that word.
  - Matching is done in code in `architect.py` (next to `OPEN_ASK`), not left to the model.
- *Done when:* pasting the four Schwab samples above into the full panel adds exactly the right tickers; all the
  phrases above open the right panel.

**Phase 6 — Setup alerts on the starred list.** Reuse server code: VWAP reclaim (quote `vwap`, `entry-gauge.ts`),
opening-range breakout (bigidea ITD-1), and MA reclaim (Intraday Cross of Daily MA). Add low-of-day bounce and base
breakout (Breakout Detection / base detection) later. Results go through the same `position_alerts` feed.

**Later (needs Don's OK).** Web push to the phone after Don approves VAPID keys (service worker in Anima). SMS: the
Twilio channel already exists in MarketFlow alerts; add an `ALERTS_SMS` switch, off by default.

## Open questions for Don
1. Extension formula: the chart shows `(price − 50DMA) / ATR`. Your formula, `((price − 50DMA)/50DMA) / ATR%`, gives
   the same number only if ATR% is measured against the 50DMA. If it's measured against price, the result is higher by a
   factor of price/50DMA (about 1.4× for a stock with a 4% ATR at 7×). Use the chart's number so alerts match what you see?
2. 5/10/20/50 "DMA": SMA or EMA? The plan defaults to whatever your chart MA settings use.
3. VIX → trim % ladder: does more VIX mean trim more? Proposed: <15 → 5%, 15–20 → 10%, 20–25 → 15%, 25–30 → 20%,
   ≥30 → 25%.
4. Trail thresholds: "very extended" ≥ 5× ATR? "Large profit" ≥ 20%? "Moderate extension" < 3×?
5. Stop and approach checks: on the live price (intraday) or on closes only? Trail is close-only.
6. Is "My positions" the only `isPortfolio` list? Should entry price stay in `targetEntry` or get its own column?
7. Which Quinn chat gets alerts — the most recent one, or a fixed "Market" chat?
8. Should "Trimmed" update shares in MarketFlow? That is a write, which the gateway doesn't allow today.
9. Allow the one bulk-add POST through the Anima embed cookie (Phase 5)?
10. Options in a paste: add the underlying, or skip them?
