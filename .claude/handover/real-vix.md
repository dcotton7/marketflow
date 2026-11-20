# Handover: the real VIX (branch `claude/great-booth-fbb87a`, 20 Nov 2026)

## Finding (read-only, keys already configured)
- FMP serves it: `/stable/quote?symbol=^VIX` (price, change %, previous close) and `/stable/historical-price-eod/light?symbol=^VIX` (daily closes).
- Finnhub does not (quote: "Market data subscription required for CFD indices"; `VIX`, `CBOE:VIX` return zeros). Alpaca snapshots carry no indices.
- Before: header tile "VIX" = VIXY (ETF); regime score = UVXY day change; Sentinel basket = VIXY; market card = VIXY + SPY realized vol.

## What changed
- `server/market-condition/vix-source.ts`: FMP quote (60 s cache, last good value kept 10 min) and closes (30 min cache); any failure -> null -> proxy stays.
- Header tile (`/api/market/indicators`): real VIX when FMP answers, label "VIX"; else label **"VIXY"** with the proxy price. Rows carry `source` and `isProxy`; the tile's tooltip shows `source`. Always on (display only).
- Regime score volatility part and Sentinel risk basket: behind env `REAL_VIX_FOR_SCORES=1`, **off by default**. On: the volatility part feeds the VIX's day change into the same formula it applied to UVXY's; Sentinel swaps VIXY's closes for the VIX's (basket key stays VIXY; `volatilitySource` "VIX"|"VIXY" is on the sentiment result; the as-of historical path stays on VIXY). The formula and stored history are untouched; switching it on makes readings differ from that day on (the VIX moves less than UVXY). PM's word before anyone sets it; it is a Render env var, not set by me.
- Market card: rules and stored rows stay on the VIXY proxy (calibrated on it). `GET /api/market-condition/setups/vix` shows the real VIX beside it.
- Tests: `npm run test:vix`.

## Left
- Flip `REAL_VIX_FOR_SCORES` only after the PM decides; Sentinel's sentiment cache is 30 min, the regime cache its own TTL.
- `rai.ts(241)` tsc error (`SPEC_GROWTH_BETA`) was already there.
