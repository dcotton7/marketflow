# Strategy research loop — design spec

Status: **DESIGN ONLY. No code yet.** Don approved the shape of this design and answered two rounds of questions (2026-10-28). The draft filters in section 2, the draft setup definitions in section 3, and the open questions in section 15 need his answers before phase 1 starts.
Written: 2026-10-28. Owner: Don.

## Goal

Turn Don's swing-trading method (Weinstein stage analysis, cup-and-handle and base breakouts, relative strength, volume) into strategies MarketFlow can test honestly, explain trade by trade, and improve in small, reviewed steps. Code computes the facts and applies Don's rules. An LLM judges only what code can't. Nothing is promoted without beating the current strategy on data it never saw, then on forward paper trades, and then Don's approval.

This spec does not place orders. Real or Alpaca paper orders stay governed by `docs/proposals/alpaca-trading-plan.md`, which is planning only. "Paper trading" here means MarketFlow records simulated entries and exits against live prices.

## 1. What exists today

What this builds on, and what is missing.

| Area | Exists | Where |
| --- | --- | --- |
| Prices | Paid Alpaca market data plan, SIP feed (`feed: "sip"` on every bars and snapshot call), split-adjusted bars. Daily and minute history back to about 2016 | `server/alpaca.ts`, `server/market-condition/providers/alpaca.ts`, `server/entry-gauge.ts` |
| Daily bars | Stored, one row per symbol and date | `historical_bars`, `server/data-layer/daily-bars.ts` (`getDailyBars`), `server/data-layer/daily-bar-refresh.ts` |
| Minute bars | Fetched from Alpaca on demand, extended hours, cached in process memory only | `server/data-layer/intraday-bars.ts` |
| Options | Alpaca OPRA feed | `server/market-condition/options/provider.ts` |
| Stored MAs | Current values only (EMA 10/20, SMA 20/50/200), no history | `ticker_ma`, `server/data-layer/moving-averages.ts` |
| Indicator library | SMA/EMA, MA slope and stacking, price vs MA distance, MA crossover, volume vs average, volume dry-up, up/down volume, ATR, ATR %, base detection, base depth, base count, distance from 52-week high, breakout detection, pullback to level, VCP tightness, RS vs index, RS score, RS line new high, RSI, MACD | `server/bigidea/indicators.ts` (`INDICATOR_LIBRARY`) |
| Point-in-time technicals | Indicators "as of" a past date | `server/sentinel/technicals.ts` (`fetchHistoricalTechnicalData`) |
| Setup detectors | Breakout, VCP, long base, HVC, undercut and rally / MA reclaim, gap and go, ORB | `shared/setup-detectors/` |
| Intraday scanner | Low-of-day bounce and other intraday signals with outcome tracking | `server/scanner/active-lod-bounces.ts`, `server/scanner/signal-producer.ts` |
| Stage logic | Wyckoff phases (accumulation, markup, etc.), not Weinstein | `server/market-condition/analysis/modules/wyckoffStage.ts` |
| Position sizing | Fixed $100k account, 1% risk, 1.5 ATR stop | `server/market-condition/analysis/modules/positionSizing.ts` |
| Outcome tracking | Intraday scanner outcomes with exact 5-minute checkpoints, episode dedupe | `server/scanner/outcome-tracker.ts`, `shared/scanner-outcome-v3.ts`, `scanner_discoveries` |
| Holdout and cost gate | Weekly chronological stability, net edge after round-trip cost, liquidity floor | `shared/scanner-evidence-holdout.ts`, `docs/signals-lab-evidence-contract.md` |
| Volatility | No VIX index level (Alpaca doesn't carry indexes); VIXY used as a proxy | `server/market-condition/engine/rai.ts`, `server/sentinel/sentiment.ts` |
| LLM calls | OpenAI (`gpt-5.1`, `gpt-4o`, `gpt-4.1-mini`), temperatures 0 to 0.7 | `server/market-condition/analysis/synthesis/`, `server/scanner/routes.ts`, `server/bridge/discord-summary.ts` |
| LLM cache | One row per symbol, 3 market days, overwritten on rerun | `marketflow_analysis_cache`, `server/market-condition/analysis/cacheService.ts` |
| Earnings and news | Finnhub earnings calendar (today forward 90 days), past surprises, company news | `server/finnhub.ts`, `analysis/modules/earnings.ts`, `analysis/modules/news.ts`, `scanner/lenses/earnings-proximity.ts` |
| Universe | Today's S&P 500, Russell 2000, and a 2020 Russell 3000 list, plus theme clusters. No list of Nasdaq-listed stocks; `fetchAlpacaActiveSymbols` in `server/alpaca.ts` lists today's active Alpaca assets only | `server/universe/constituents.ts`, `server/market-condition/universe.ts` |
| Delisted names | Removed from the universe and persisted as excluded | `server/market-condition/utils/delisted-ticker-registry.ts`, `data/delisted-symbols.json` |
| Discord relay | Room messages held in memory on Live only, lost on restart | `server/bridge/discord-relay.ts` |
| Anima access | Read-only gateway with a route allowlist, embed cookie for framed pages | `server/middleware/animaGateway.ts` (`ALLOWED`), `server/middleware/animaEmbed.ts`, `server/middleware/dataAccess.ts` (`RULES`) |

Prices are not a gap. The paid Alpaca SIP plan covers daily and minute bars for the whole test period, and the research uses it as the only price source.

### Gaps this spec must close or work around

Code to build:

- **No Weinstein stage, no 30-week MA, no weekly bars.** Weekly bars are built from daily bars (the last session of each week).
- **No cup-and-handle detector.** The base and breakout indicators are a start; the handle needs new code.
- **RS in the scanner is one-day only.** `scanner/lenses/relative-strength.ts` compares today's change to SPY. Multi-week RS exists only in the BigIdea indicators, against SPY, not QQQ.
- **No backtester.** The outcome tracker measures intraday scanner signals forward; nothing replays history with entries, stops, trims and sizing.
- **`ticker_ma` is not point-in-time.** Backtests compute MAs from `historical_bars` for each date.
- **Minute bars aren't stored.** Ten years of minute bars for a universe of several thousand names is billions of rows, far too much for the shared database. Intraday backtests fetch minute bars only for names that pass the liquidity floor, on days a daily pre-filter flags, and cache them as files on Don's PC.

Data that is genuinely missing:

- **Delisted-name history (survivorship bias).** The universe is today's lists, and delisted names are actively purged. Names that failed in the past are missing from both the universe and `historical_bars`. Backtests on this data look better than reality.
- **Point-in-time universe membership.** Which stocks were in the S&P 500 on each past date, and which common stocks were listed on Nasdaq on each past date (including later delisted, merged or bankrupt ones, and their security type, so ETFs, warrants, units, rights and preferreds can be excluded).
- **Point-in-time earnings and news.** The earnings module asks Finnhub for dates from today forward. Historical earnings dates (and when they were known), and news as it was known on a past date, need checking against the Finnhub plan.
- **Market regime inputs that aren't stock prices:** VIX and VIX3M daily history (term structure), the 10-year Treasury yield, and Fed rate decisions. Free official sources exist (Cboe's published VIX history, FRED series such as `VIXCLS`, `DGS10` and the Fed funds target range). VIXY is not a substitute: it decays over time and can't give VIX levels.

Other constraints:

- **Dividends.** Bars are split-adjusted only. Fine for price patterns; buy-and-hold benchmarks add dividends back or the comparison flatters the strategy.
- **LLM cache overwrites.** Research verdicts need their own table that is never overwritten.
- **Discord ideas are not stored.** They can't be a backtest feature.
- **LOCAL and LIVE share one database** (noted in the Alpaca plan). Research tables written by jobs on Don's PC appear on Live at once. Useful for Live and Quinn, but heavy jobs must not run on Render, which already runs a memory gate (`server/infra/memory-gate.ts`).

## 2. Layers

Four layers. Each one only does what the layer below can't.

### Layer A — facts (code)

Computed for every symbol and every date, as of that date's close (or that minute for intraday), never using later bars:

- Moving averages: 5 SMA, 10/20 EMA and SMA, 50/150/200 SMA daily; **10-week and 30-week SMA on weekly closes** (the 30-week MA drives Weinstein stages).
- MA slopes, including the 30-week MA change over the last 4 weeks.
- **Extension from an MA in ATR multiples:** `((price − MA) ÷ MA) ÷ ATR%`, with ATR% = ATR(14) ÷ price. Computed for the 50DMA (drives trims) and for the 5, 10 and 20DMA (picks the trailing MA). See section 4.
- RSI(14), MACD(12,26,9) and histogram.
- ATR(14) and ATR as percent of price.
- Relative volume: today's volume over the 50-day average; weekly volume over the 10-week average; intraday volume vs the same time of day on prior sessions.
- Relative strength vs SPY and vs QQQ: return difference over 63 and 126 days, Mansfield RS (stock/index ratio vs its own 52-week average), RS line distance from its 52-week high, and an RS percentile rank within the universe.
- Distance from the 52-week high.
- Base and pattern facts: base start, length, depth, pivot, handle (start, depth, length, volume), contractions, prior uptrend into the base.
- Intraday facts from minute bars: VWAP, opening range high and low (5, 15, 30 minutes), low and high of day so far.
- Gap size vs prior close, and whether the gap day was an earnings day (when known point-in-time).
- Average daily dollar volume (20-day) and price.
- The regime state for that date (section 5).

Reuse the math in `server/bigidea/indicators.ts`, `shared/ma-math.ts` and `shared/setup-detectors/` where it fits. Wrap each fact in one pure function that takes bars up to a point in time, so live and backtest use the same code.

**Position sizing** is a fact too. The hard 5% loss cap (section 4) sets the most a position can lose. Account-level risk sets how big the position is: `shares = floor(equity × account risk% ÷ (entry − stop))`, capped at a maximum position size. Don's example: a $100,000 position with a 5% stop can lose at most $5,000. This replaces the fixed $100k assumption in `positionSizing.ts` for research.

### Layer B — Don's rules (code, pass/fail)

Every rule is an explicit check with a name, a threshold, a pass/fail result and the measured value, so a decision can say "failed `volume_breakout`: 1.2× vs 1.5× required". Setup-specific checks are in section 3. Hard trade rules are in section 4. The filters below apply to every setup and are a **draft for Don to confirm**:

**Market filter**
- [ ] `market_stage`: SPY (or QQQ, Don to pick) closes above its 30-week MA and the MA is not falling. Otherwise no new longs. The regime work (section 5) may later replace this with a tested regime filter.

**Relative strength**
- [ ] `rs_rank`: RS percentile at least 80 in the universe.
- [ ] `rs_line_high`: RS line vs SPY within 5% of its 52-week high.
- [ ] `rs_vs_qqq`: 63-day return above QQQ's.

**Liquidity** (applied first; critical with the whole Nasdaq in the universe, see section 7)
- [ ] `price_min`: close at least $10.
- [ ] `dollar_volume_min`: 20-day average dollar volume at least $20M.

**Earnings**
- [ ] `earnings_gap`: no new entry within 5 sessions before earnings (code when the date is known point-in-time; otherwise the LLM layer judges it). Does not apply to the earnings gap setup itself.

A setup becomes a **candidate** when its own checks pass (section 3), the filters above pass, and it fits the hard rules (section 4). Each strategy version says which filters are required.

### Layer C — context judge (general LLM)

Runs only on candidates (a small share of the universe), so cost stays bounded. It judges what code can't:

- Earnings timing when no structured date exists, and whether a recent report helped or hurt the setup.
- Catalyst quality: real business news (contract, guidance, product) vs noise. Central to the earnings gap / episodic pivot setup.
- Contradicting news: offering, lawsuit, downgrade, accounting issue, pending acquisition (a capped upside).

Rules for this layer:

- Low temperature (0 to 0.2), fixed model id, fixed prompt version.
- Input: the code facts plus headlines and earnings info **known as of the decision date**, anonymized (section 8).
- Output is structured: `verdict` (`take` / `skip` / `caution`), `confidence` (0 to 1), `reasons` (short list), `flags` (e.g. `earnings_within_5d`, `offering`).
- Every verdict is saved with its reasons and never overwritten. Same input, same prompt version and same model means the cached verdict is reused, not re-asked.
- It can only veto or downgrade a candidate. It never creates trades code didn't find.

### Layer D — specialist signal (optional, tested separately)

A narrow model that adds one number, for example news sentiment (FinBERT-style) on the same headlines, or a pretrained time-series forecaster. It is a feature, not a judge. It gets its own ablation (section 7) and the same contamination checks as the LLM (pretrained models also saw history). It ships only if it adds measurable edge on top of rules and the LLM. The existing `analysis/modules/sentiment.ts` is a starting point to compare against.

## 3. Setup library

Each setup is its own detector with a precise definition in code, tested on its own and in combination. The definitions below are **drafts for Don to confirm or correct**. Every setup must also produce a logical stop; if that stop is more than 5% below entry, section 4 applies.

### Intraday setups (Alpaca minute bars)

The intraday detectors find the entry. The position is then managed by the same exit policy as daily setups unless a strategy version says "flat by the close".

**Low-of-day bounce / reclaim** (builds on `server/scanner/active-lod-bounces.ts`)
- Stock is on the daily candidate list (uptrend, RS and liquidity filters pass).
- After the first 15 minutes, price sets a new low of day, ideally into a level (prior day low, 20/50DMA, VWAP band).
- Trigger: a 5-minute close back above the level it undercut, with that bar's volume above the time-of-day average.
- Stop: below the low of day.

**Buying above VWAP / VWAP reclaim**
- Above VWAP: price holds above VWAP for the first 30 minutes and trades through the morning high. Trigger on the break.
- Reclaim: price spends at least 6 five-minute bars below VWAP, then a 5-minute bar closes above VWAP on volume of at least 1.5× time-of-day average.
- Stop: below the low of the reclaim move, or below VWAP by a set ATR fraction.

**Opening range breakout** (builds on `shared/setup-detectors/orb.ts`)
- Opening range = high and low of the first 5, 15 or 30 minutes (one choice per strategy version).
- Trigger: a 5-minute close above the range high, with volume above the time-of-day average.
- Stop: below the range low, or the range midpoint if the low is beyond 5%.

### Daily setups

**MA cross / reclaim (10, 20, 50)** (builds on `shared/setup-detectors/ur.ts`)
- At least 3 closes below the MA, then a close back above it.
- The MA is flat or rising; for the 50DMA reclaim, the 200DMA is rising.
- Volume on the reclaim day at least 1.0× the 50-day average.
- Stop: below the undercut low.

**Base breakout** (builds on `shared/setup-detectors/breakout.ts`, base indicators)
- Base at least 5 weeks (25 sessions), depth 8% to 35%.
- Pivot within 15% of the 52-week high.
- Close above the pivot on volume at least 1.5× the 50-day average.
- The last 5 sessions before breakout average under 0.8× the 50-day average volume (dry-up).
- Entry no more than 5% above the pivot. Stop: below the last contraction low inside the base.

**Cup and handle** (new detector)
- At least 30% rise into the left lip.
- Cup 7 to 65 weeks long, 12% to 35% deep, with at least 3 weeks in its lower third (rejects V shapes).
- Handle low in the upper half of the cup, handle depth 12% or less, at least 5 sessions long, average volume below the 50-day average.
- Trigger: handle high plus $0.10, on volume at least 1.4× the 50-day average. Stop: below the handle low.

**VCP** (builds on `shared/setup-detectors/vcp.ts`, VCP Tightness indicator)
- Two to four contractions, each shallower than the last (for example 25%, 12%, 6%).
- Volume falls through the contractions.
- Last contraction 10% or less. Pivot = high of the last contraction; breakout on volume at least 1.5× average.
- Stop: below the last contraction low.

**Pullback to 10/20DMA in an uptrend** (builds on the Pullback to Level indicator)
- Uptrend: 10DMA > 20DMA > 50DMA, all rising, price above the 30-week MA.
- Price pulls back to within 1% (or 0.5 ATR) of the 10 or 20DMA after at least a 10% advance off the last base.
- Pullback volume below average; trigger on a close back above the prior day's high.
- Stop: below the pullback low.

**Earnings gap / episodic pivot** (builds on `shared/setup-detectors/gap-and-go.ts` and `hvc.ts`)
- Gap up of at least 8% on earnings or major news, volume at least 3× the 50-day average by the close.
- Close in the upper half of the day's range.
- Prior 3 months without a large run-up (not already extended).
- Entry: above the gap-day high, or an opening range breakout on the next session. Stop: below the gap-day low. The 5% cap will often bind here; section 4 decides.
- Needs the earnings date point-in-time to separate earnings gaps from other news gaps; the LLM judges catalyst quality.

**Weinstein Stage 2 breakout** (new detector)
- Weekly close above the 30-week SMA, and the 30-week SMA higher than 4 weeks ago.
- Before the breakout, at least 8 weeks of Stage 1: the 30-week MA flat (within ±2% over 8 weeks) and price crossing it more than once.
- Breakout above the Stage 1 range on weekly volume at least 2× the 10-week average.
- Mansfield RS vs SPY above zero and rising.
- Not extended: close no more than 25% above the 30-week MA.
- Stop: below the Stage 1 range high or the last weekly swing low.

## 4. Hard trade rules and the exit policy

### Fixed constraints (never varied, never optimized)

These are Don's rules. Every strategy version obeys them. The improvement loop can't propose changing them.

- **Maximum loss per trade: 5% from the entry price.** Smaller is better. A $100,000 position can lose at most $5,000.
- **If the setup's logical stop is more than 5% below entry, the trade doesn't happen at that price.** Either it is skipped, or entry waits for a price where the logical stop is within 5% (for example a pullback toward the stop level). A waiting entry expires after a set number of sessions (draft: 5) and is logged as "skipped: stop too wide".
- The stop is always the tighter of the logical stop and entry − 5%.
- **Trims always happen into strength:** on an up move, never into weakness. In the backtest a trim fills only when price trades above the prior session's high.
- **A trailing piece is always kept** after trims and is exited only by the trail (or the original stop).

Reports show how many candidates each setup lost to the 5% cap, since that tells Don which setups fit his risk rule.

### Exit policy (parameterized)

One exit policy, with parameters. Each set of parameter values is a separate strategy version, tested and compared like any other.

1. **Initial stop:** as above.
2. **Trims (trigger fixed):** a trim is due when extension from the 50DMA reaches 7: `((price − 50DMA) ÷ 50DMA) ÷ ATR% ≥ 7`, with ATR% = ATR(14) ÷ price. Confirmed by Don. The trim becomes due at a close where extension is 7 or more, and fills into strength on a later session: the first minute bar that trades above the prior session's high, at that bar's price minus slippage. If no bar does, the trim stays pending while extension stays at 7 or more. A further trim is due each time extension falls back below 7 and reaches it again, up to a cap on the total trimmed (tested: 30%, 50%, 70% of the original position).
3. **Trim size vs VIX (found by the backtest):** trim size is 5% to 25% of the position, set by the VIX bucket at the time of the trim. The mapping is a tested parameter, not a rule.

   | VIX bucket | Values tried |
   | --- | --- |
   | under 15 | 5%, 10%, 15%, 20%, 25% |
   | 15 to 20 | 5%, 10%, 15%, 20%, 25% |
   | 20 to 30 | 5%, 10%, 15%, 20%, 25% |
   | over 30 | 5%, 10%, 15%, 20%, 25% |

   The search space is every mapping where trim size never falls as VIX rises (70 mappings), plus the 5 flat mappings that ignore VIX as the baseline. Start with a coarse grid (flat 10%, flat 20%, 5/10/15/25, 5/10/20/25, 10/15/20/25) and widen only around the best region. Every mapping tried counts toward the multiple-testing total (section 9).
4. **Trailing piece (extension-dependent MA, thresholds found by the backtest):** which MA the trail uses depends on how far price is above the MAs, measured in the same ATR multiples. At each close:
   - **Very extended → 5DMA:** when extension above the 10DMA is at least `X_far`, the trail is a close below the 5DMA.
   - **Large profit, moderate extension → 20DMA:** when open profit is at least `P_large` and extension above the 20DMA is at most `Y_moderate`, the trail is a close below the 20DMA.
   - **Otherwise → 10DMA:** a close below the 10DMA.

   The MA choice uses that close's values, which are known at the close. A close below the chosen MA exits the trailing piece at the next open. Trims into strength continue along the way.

   | Threshold | Starting grid |
   | --- | --- |
   | `X_far` (ATR multiples above the 10DMA) | 2, 3, 4, 5 |
   | `P_large` (open profit) | 3R, 5R, 8R |
   | `Y_moderate` (ATR multiples above the 20DMA) | 1, 2, 3 |
   | hysteresis (closes in the new state before switching) | 1, 2 |

5. **Stop to break-even:** option, off by default: after the first trim, move the stop to entry.

**Tested variants:** the trim-size-vs-VIX mapping, the trim cap, and the trail thresholds above. Other exit styles run as separate strategies on the same entries, for comparison:

- **Baseline:** fixed 10DMA trail, flat 10% trims. Shows what the extension-dependent trail and the VIX mapping add.
- **Position (reference):** trail on a weekly close below the 10-week MA, or the Weinstein exit (weekly close below the 30-week MA). The 5% initial stop and trims still apply.
- **Intraday only (reference):** flat by the close, for the intraday setups.

## 5. Regimes and success patterns

The aim is to learn which setups work in which market conditions, using conditions that can be measured on any date.

### Regime state per date

A new table (e.g. `regime_daily`) holds one row per trading day since 2016. Every field is computed from data known by that day's close.

**Trend (SPY and QQQ separately)**
- Close vs 50DMA and 200DMA (above or below each).
- 50DMA and 200DMA slope over 20 sessions (rising, flat, falling).
- Weinstein stage of the index on weekly bars.

**Drawdown**
- SPY and QQQ drawdown from their 52-week high, in buckets: under 5%, 5% to 10%, 10% to 20%, over 20%.

**Volatility**
- VIX level, in buckets: under 15, 15 to 20, 20 to 30, over 30.
- VIX 5-day change (rising fast, stable, falling).
- Term structure: VIX ÷ VIX3M. Above 1 (backwardation) means stress.
- Source: Cboe VIX and VIX3M daily history, or FRED `VIXCLS`. Not available from Alpaca.

**Breadth**
- Share of S&P 500 members above their 50DMA (under 30%, 30% to 60%, over 60%), computed from Alpaca bars using point-in-time membership.

**Rates**
- 10-year Treasury yield and its 50-day change (rising, flat, falling). Source: FRED `DGS10`.
- Fed stance from the last FOMC decision: hiking, holding, cutting. Source: FRED target range series, or a small hand-entered FOMC decisions table.

**Event tags** (descriptive labels, dates to verify)

| Tag | Dates |
| --- | --- |
| President and party | Obama (D) to 2017-01-20; Trump (R) 2017-01-20 to 2021-01-20; Biden (D) 2021-01-20 to 2025-01-20; Trump (R) from 2025-01-20 |
| Elections | 2016-11-08, 2018-11-06, 2020-11-03, 2022-11-08, 2024-11-05, 2026-11-03 (tag 30 sessions before to 10 after) |
| Tariff shock 2018–19 | 2018-03-01 to 2019-12-13 (US–China trade war to the phase one deal) |
| Covid crash | 2020-02-19 to 2020-03-23 (peak to low), recovery tag to 2020-08-18 (new SPY high) |
| 2022 bear market | 2022-01-03 to 2022-10-12 |
| Ukraine war | from 2022-02-24 (tag the first 30 sessions as the shock) |
| Bank crisis | 2023-03-08 to 2023-05-01 (SVB to First Republic) |
| Israel war | from 2023-10-07 (first 30 sessions as the shock) |
| Tariff shock 2025 | 2025-04-02 to 2025-05-12 |

New events are added by hand as they happen, with a start date and a shock window.

### Regime stored on every trade

Every backtest decision, paper trade and live decision stores the regime row id for its entry date (and the regime at exit). Don's own journaled trades (`sentinel_trades`, imported trades) can be tagged the same way, so he can see his own results by regime next to the strategy's.

### Reports

- **Setup × regime table:** for each setup and each regime bucket (one regime dimension at a time, plus a few chosen pairs such as VIX × SPY vs 200DMA): trade count, win rate, expectancy in R, average R, with 95% confidence intervals (bootstrap).
- **Minimum sample:** cells under 30 trades are shown greyed as "too few to judge", with no expectancy colour.
- **Heatmap:** setups as rows, regime buckets as columns, colour by expectancy in R, only for cells with enough trades. Hovering shows n, win rate and the interval.
- The research page shows the current regime row so Don can see which cells apply today.

### What regimes can and can't tell us

- **President and party is a descriptive tag only, never an optimized input.** The test window holds about three presidential terms. Each one coincides with its own rates, Fed policy and shocks (Covid, the 2022 bear market), so any difference by party is confounded and can't be separated from those causes.
- The same caution applies to single events: each is one episode, not a sample.
- **Measurable features carry the signal:** VIX level and term structure, trend, drawdown, breadth and rates. Those are the only regime inputs that strategies, filters or the learned model may use.
- Many cells means some will look good by chance. The heatmap is for finding ideas, not for proving them.

### Regime filters in the improvement loop

The critic (section 9) may propose regime filters such as "no base breakouts when VIX is over 30 and SPY is below its 200DMA". A filter is a normal challenger: it must pass validation, the multiple-testing gate and the locked holdout, and Don approves it. A filter that only removes a handful of trades is rejected as too thin.

## 6. Strategy as a versioned package

A strategy is one immutable package. Changing anything makes a new version.

| Part | Contents |
| --- | --- |
| `id` | e.g. `wein-cwh-v7` plus a content hash |
| `parent_id` | the version it was derived from |
| `setups` | which setups from section 3, with their thresholds |
| `rules` | which layer B filters are required, and their thresholds |
| `regime_filters` | approved regime filters, if any |
| `exit_policy` | VIX-to-trim mapping, trim cap, trail thresholds (`X_far`, `P_large`, `Y_moderate`, hysteresis), exit style, exit fill (next open or 15:55) |
| `params` | account risk %, max positions, max position size, wait-for-entry sessions, cost model, universe id |
| `llm` | model id, its knowledge cutoff, prompt text, prompt version, temperature, on/off |
| `specialist` | model id and version, on/off |
| `learned_model` | trained model file id and its training window, on/off |
| `created_by` | `don`, `critic`, or `manual` |
| `change_note` | plain words: what changed and why |
| `status` | `draft`, `challenger`, `paper`, `champion`, `retired` |

Stored in a new table (e.g. `strategy_versions`) with the package as JSON and the hash unique. The hard rules in section 4 are not part of the package; they are enforced by the harness for every version. Prompts and model files are stored by hash so old versions can always be re-run exactly. Exactly one version is `champion` at a time.

## 7. Evaluation harness

One backtester for every strategy version. It runs on Don's PC as a script (like `scripts/`), not on Render, and writes results to the shared database.

### Universe

**Every Nasdaq-listed common stock, plus the S&P 500**, each as it was on that date. That is roughly 3,000 to 3,500 names at any time, several times larger than an index-only universe. Consequences:

- **Liquidity floors matter much more.** Most Nasdaq listings are small and thinly traded. The price and dollar-volume floors (layer B) are applied first, on each date, before any setup check, and are reported with every result. Floors are tested at a few levels (for example $10 / $20M and $5 / $10M) so Don can see how much edge comes from small, costly-to-trade names. Slippage for names near the floor uses the higher tier.
- **Membership history is a data need.** Point-in-time Nasdaq listings (with delisted names and security type) don't exist in the repo today; `server/universe/constituents.ts` has no Nasdaq list, and Alpaca's asset list shows only today's symbols. Common-stock-only filtering needs a security-type source (for example Finnhub's US symbol list, which marks common stock).
- **Compute and cost grow.** Daily facts for about 3,500 names over ten years is around 9 million symbol-days per run, fine for a script on Don's PC but not for Render. More candidates also means more LLM calls, so the code rules and liquidity floor must filter hard before layer C, and per-run budgets apply.
- **Minute bars only for liquid names.** Intraday setups fetch minute bars only for names that pass the liquidity floor on that date, and only on days the daily pre-filter flags.

### Point-in-time only

- On each date, only bars, earnings dates, news and regime data available by that time may be used.
- **Entries happen exactly when the trigger would have been known in real time, never using later information:**
  - Intraday setups (low-of-day bounce, VWAP, opening range breakout) fill on the minute bar after the trigger bar, at that bar's price plus slippage.
  - Daily setups that trigger on the close fill at the next session's open, plus slippage. A variant fills near the close: the trigger is evaluated on the 15:55 minute bar (with that day's values computed as of 15:55) and fills at that bar's price plus slippage.
  - Exits follow the same rule: a close below the trailing MA exits at the next open (or at 15:55 in the near-close variant); stops fill at the stop price, or at the open if price gaps through it.
- MAs, RS ranks and breadth are computed from `historical_bars` as of each date, never from `ticker_ma`.
- The universe on each date is the membership as of that date (see survivorship below).
- A test asserts that changing future bars changes no past decision.

### Costs

- Commission: $0 (configurable).
- Slippage: 10 bps per side for names over $50M daily dollar volume, 25 bps under that, plus the gap when a stop or entry is jumped. Intraday entries add the bar's spread estimate. Same idea as `evaluateCostSensitivity` in `shared/scanner-evidence-holdout.ts`, applied per trade.
- Results are always reported net of costs.

### Walk-forward windows

Alpaca SIP daily and minute history runs from about 2016, so roughly ten years are available.

- **Locked holdout:** the most recent 12 months. Never used for tuning. Checked rarely (section 9).
- **Walk-forward on the rest:** tune on 3 years, validate on the next 6 months, roll forward 6 months, repeat. Report each validation window separately and combined.
- Every window reports its regime mix (section 5) so results can be read by regime.

### Metrics

Per run, per window, net of costs:

- Trade count (and trades per year). Results under 30 trades are labelled "too few to judge".
- Candidates skipped by the 5% cap, and waiting entries that expired.
- Win rate.
- Expectancy per trade in R (average R-multiple) and in percent.
- Average win R, average loss R, profit factor.
- Share of profit from trims vs the trailing piece.
- Max drawdown of the equity curve (with position sizing and max positions applied), and its length.
- CAGR, exposure (time in the market), Sharpe.
- Versus buy-and-hold SPY and QQQ over the same window, with dividends added back for the benchmarks.

### Ablations

Each run reports the same windows for:

1. Rules only.
2. Rules + LLM context judge.
3. Rules + specialist.
4. Rules + LLM + specialist.
5. Rules + learned model (once it exists).

A layer stays on only if it improves expectancy or drawdown without cutting trade count below the minimum.

### Survivorship bias

- Build a point-in-time universe: which symbols were S&P 500 members or Nasdaq-listed common stocks on each date, including ones later delisted, merged or bankrupt. Nasdaq has many more delistings than the S&P 500, so the bias is larger there until this is filled.
- Prices for those names come from Alpaca where it still serves bars for inactive symbols. Names Alpaca no longer serves are the one price gap; how to fill it (a delisted-name history dataset) is an open question.
- Until that is solved, every report carries a "survivorship-biased universe" warning, and promotion decisions compare versions against each other on the same universe (the bias is roughly shared), never against absolute targets.
- The delisted registry stays as is for the live app. Research gets its own universe table so the live purge doesn't erase research history.

## 8. LLM lookahead contamination

A general LLM may remember what happened to a stock after the decision date ("NVDA in May 2023"). That makes its backtest verdicts look smarter than they are. Mitigations, all required:

- **Anonymize inputs.** Replace ticker and company name with a token (`STOCK_A`), strip or generalize product and executive names in headlines where possible, shift all dates to relative days ("day 0", "earnings in 4 sessions"), and send prices as percentages from the pivot rather than dollar levels. Keep the sector in broad words only. Event tags (section 5) are never sent; they would give the date away.
- **Leak probe.** Before trusting a prompt, ask the model to name the anonymized stock or its later return on a sample. If it identifies more than chance, the anonymization is not good enough.
- **Post-cutoff testing only.** Each package records its model's published knowledge cutoff. The LLM layer's ablation result counts only on decision dates after that cutoff plus a 3-month margin. Earlier dates may be run for debugging, but their numbers are labelled contaminated and never used for promotion.
- **The sample will be small.** Post-cutoff windows for current models cover a year or two at most, and part of that is the locked holdout. Expect few trades and treat LLM-layer evidence as weak until forward paper trading confirms it.
- **Forward paper trading is the true test** (section 9). No model can remember the future.

Code rules and the learned model have no memory of history, so their backtests don't need this guard. The specialist model does, if it is pretrained.

## 9. The improvement loop

### Champion and challengers

- The **champion** is the current approved version. Everything else is a challenger.
- Each **round** produces N challengers (default 5) from the champion.

### The critic

A separate LLM call (the critic) reads the champion's decision log for the latest validation window, focused on:

- Losing trades, with their facts, rule results, regime and LLM reasons.
- Skipped candidates that would have won (missed trades).
- Rule checks that barely passed or barely failed.
- Setup × regime cells with enough trades and clearly negative expectancy.

It proposes **concrete diffs**, each with a one-line reason tied to logged trades:

- A threshold change (`volume_breakout` 1.5× → 1.8×).
- A new filter built from existing facts (skip if ATR % over 6).
- A regime filter (section 5).
- An exit policy variant (VIX-to-trim mapping, trim cap, trail thresholds).
- A prompt edit for the context judge.
- A new fact to compute (handle volume trend).

The critic may only use facts that exist point-in-time, can't touch the hard rules in section 4, and never sees the holdout.

### Promotion gates

A challenger is promoted only if all are true:

1. **Better on walk-forward validation:** higher expectancy in R, max drawdown no worse than the champion's by more than a set margin, trade count at least the minimum.
2. **Survives multiple testing:** deflated Sharpe ratio (or a similar correction that accounts for how many variants were tried) still above the threshold. The total count of variants ever tested is tracked per holdout period.
3. **Better on the locked holdout.** The holdout is checked at most once per 5 rounds, and every check is logged with what was compared. A challenger that fails the holdout can't be resubmitted with a trivial change.
4. **Forward paper trading:** runs alongside the champion on live data for a set period (default 8 weeks or 20 trades, whichever is longer) without falling behind beyond a margin.
5. **Don approves** in the promotion UI. Nothing becomes champion automatically.

When the holdout has been checked many times (default: 4 checks), it is considered used up. A fresh holdout is formed from data that has arrived since, and the old one joins the walk-forward history.

### Cost controls

- Verdict cache: key = hash of (anonymized input, prompt version, model id). Reruns of unchanged inputs cost nothing.
- The LLM is only called on candidates that passed code rules.
- A spend budget per round and per month, configured in one place; a round stops and reports when it hits the budget.
- The critic runs once per round, not per trade.
- Minute bars are fetched only for flagged days and cached on disk, so intraday reruns don't refetch.
- Spend per round is stored with the round's results.

## 10. Learning data

### Decision log

Every candidate the strategy evaluates (taken or skipped), in backtest, paper and live, gets one row in a new table (e.g. `strategy_decisions`):

- Strategy version id, run id, mode (`backtest`, `paper`), setup, symbol, decision time.
- All layer A facts as of that time.
- Regime row id at entry and at exit.
- Every rule result with its measured value.
- LLM verdict, confidence, reasons and flags (by reference to the saved verdict).
- Specialist score, learned-model score (when present).
- Decision: taken, skipped, or waiting, and why (including "stop too wide").
- Planned entry, stop, size; each trim (time, price, share of position); the trail exit.
- Outcome: R-multiple of the whole trade and of each piece, first target hit before stop (yes/no), max favorable and adverse excursion in R, days held, exit reason.

Skipped candidates are labelled too ("what would have happened"), so filters can be judged on what they removed.

### Learned model

- Once there are several thousand labelled decisions, train a simple model (gradient boosting) on layer A facts and measurable regime features to score setups: probability of a positive R, or expected R.
- Event tags and president/party are excluded as inputs.
- Trained only on walk-forward training windows; evaluated like any other layer, with its own ablation.
- Saved by file hash in the strategy package with its training window.
- Feature importance is reported so Don can see what it leans on.

The general LLM stays the context judge and explainer. It is not fine-tuned on returns: the sample is too small, the result can't be explained, and it would deepen the contamination problem.

## 11. Strategy decay and retirement

- **Rolling re-test:** each month, re-run the champion on the latest 6 and 12 months and compare to its own history.
- **Decay alarm:** if rolling 6-month expectancy in R falls below a set floor (e.g. under 0.1R) or drawdown exceeds its worst backtest drawdown by a margin, flag it on the research page.
- **Check the regime first:** the alarm shows the current regime and the champion's historical results in that regime. A strategy that has always been weak in this regime is not decaying; it is in its bad cell.
- **Retirement:** a flagged champion is reviewed by Don. Options: keep, reduce account risk %, pause (no new paper entries), or retire and promote the best challenger that passes the gates. Retired versions stay stored and re-runnable.

## 12. Quinn (Anima companion) integration

MarketFlow is the source of truth. Anima reads it read-only through the existing gateway (`/api/anima/<path>` runs `GET /api/<path>` as the owner). No research data is copied into Anima.

### New read-only routes

All are plain reads of stored results. None runs a backtest, calls an LLM, or writes anything. The gateway already drops `force` and `refresh`; these routes take neither.

| Route | Returns |
| --- | --- |
| `GET /api/research/champion` | Current champion id, when promoted, its setups, rules and exit policy in plain words ("Stage 2: weekly close above a rising 30-week average…"), and its headline backtest and paper numbers |
| `GET /api/research/rounds/latest` | Latest round: challengers tried, what each changed, validation results, whether the holdout was checked, outcome, spend |
| `GET /api/research/decisions/:id` | One decision: symbol, date, setup, regime, facts, each rule pass/fail with values, the saved LLM verdict and reasons, trims and outcome |
| `GET /api/research/paper/performance` | Paper trading for champion and challengers in paper: open and closed trades, win rate, expectancy in R, drawdown, vs SPY/QQQ |

Wiring, when each route ships:

- Add the route to `ALLOWED` in `server/middleware/animaGateway.ts` (e.g. `^/api/research/(champion|rounds/latest|decisions/\d+|paper/performance)$`) with a test in `animaGateway.test.ts`.
- Add an `owner` rule in `server/middleware/dataAccess.ts` for `/api/research/`, since results are computed from licensed vendor data.
- Write routes (start round, approve promotion) stay off the allowlist and stay `owner_admin`.
- Anima's own client code needs a matching read. That is Anima-side work, not part of this repo.

### Quinn's knowledge

Anima's `knowledge/common.md` gets a short entry **only when each piece ships**, so Quinn knows the concepts and limits without claiming abilities that don't exist. This spec does not edit the Anima repo. Draft wording per piece:

- **Phase 1 shipped:** "MarketFlow can backtest Don's swing setups (Weinstein Stage 2, base and cup-and-handle breakouts, pullbacks, VCP, earnings gaps) on past daily bars under his hard rule of never losing more than 5% on a trade. Results are biased upward because past delisted stocks are missing. You can't see or run backtests yet."
- **Phase 2 shipped:** "MarketFlow labels every past day with its market regime (trend, VIX, breadth, rates) and shows which setups worked in which regimes. Party and president are labels only, not causes."
- **Phase 3 shipped:** "Some strategy versions use an AI check on news and earnings before a trade. Its reasons are saved. Backtest results for it only count after the AI's training cutoff."
- **Phase 4 shipped:** "MarketFlow tests improved versions of Don's strategy in rounds. Don approves any change; nothing switches on its own."
- **Phase 6 shipped:** "You can read the current champion strategy and its rules, the latest round, why a given trade was taken or skipped, and paper-trading results. These are paper results, not real trades. You can't change the strategy, run tests, or place trades, and you don't give buy or sell advice."

## 13. Phased build plan

Each phase ships on its own and is usable before the next starts.

### Phase 1 — facts, daily setups, hard rules, regimes, point-in-time backtest

Build: weekly bars from daily; layer A facts as pure functions over bars up to a date; the daily setups in section 3 and the layer B filters as named checks; the hard rules and exit policy in section 4; `regime_daily` with VIX, rates and FOMC data loaded; point-in-time S&P 500 membership and Nasdaq common-stock listings, with the liquidity floor applied per date; the backtester with costs, sizing, walk-forward windows and metrics; `strategy_versions` with the first versions (one per exit style).

Acceptance:
- Facts match hand-checked values on 5 symbols across 3 dates (including the 30-week MA, the 50DMA extension in ATR multiples, and a Stage 2 call on a known chart Don picks).
- Each daily setup finds at least 3 examples Don picks by hand, on the right dates.
- No trade loses more than 5% from entry plus slippage; trims only fill into strength; every trade keeps a trailing piece until the trail exits.
- The lookahead test passes (changing future bars changes no past decision).
- `regime_daily` covers every trading day since 2016 with no missing fields.
- A full walk-forward run finishes on Don's PC, reports every metric net of costs, and shows SPY/QQQ buy-and-hold for the same windows.
- Re-running the same version gives identical results.
- Reports carry the survivorship warning until delisted-name history is filled.

### Phase 1b — intraday setups

Build: daily pre-filter that flags days worth checking; minute-bar fetch and disk cache for flagged days; low-of-day bounce, VWAP, and opening range breakout detectors; intraday entries feeding the same exit policy.

Acceptance:
- Each intraday setup matches 3 hand-picked examples to the minute.
- A second run makes no new minute-bar requests for cached days.
- Results report intraday-only and intraday-entry-then-swing styles separately.

### Phase 2 — decision log and regime reports

Build: `strategy_decisions` for every candidate, taken, skipped or waiting, with outcome labels and regime ids; a research page that lists runs and decisions; the setup × regime table and heatmap with confidence intervals; optional regime tagging of Don's journaled trades.

Acceptance:
- Every trade in a backtest has a decision row; counts match the backtest's trade count.
- Skipped candidates (including "stop too wide") have "would have" outcomes.
- Heatmap cells under 30 trades show as "too few to judge"; others show n, win rate, expectancy and a 95% interval.
- Don can open any decision and see why it was taken or skipped in plain words.

### Phase 3 — LLM context verdict with contamination guards

Build: the context judge on candidates; anonymizer; leak probe; verdict table and cache; budget; ablation rules only vs rules + LLM, scored only after the model's cutoff.

Acceptance:
- Leak probe identifies anonymized stocks no better than chance on a 100-case sample.
- Second run of the same backtest makes zero new LLM calls (all cached).
- Spend per run is reported and a run stops cleanly at its budget.
- The ablation report shows pre-cutoff results labelled contaminated and excluded.

### Phase 4 — critic, champion/challenger, holdout

Build: rounds, critic proposals as diffs (including regime filters and exit variants), N challengers per round, promotion gates including deflated Sharpe and the holdout check limit, variant counter.

Acceptance:
- A round produces N challengers, each with a readable diff and reason tied to logged trades.
- No proposal changes a hard rule; one that tries is rejected and logged.
- The holdout can't be checked more often than the limit; every check is logged.
- No challenger reaches `paper` without passing validation and the multiple-testing gate.

### Phase 5 — learned model

Build: training job on labelled decisions (walk-forward windows only, measurable regime features, no event tags), model stored by hash, ablation with and without it, feature importance report.

Acceptance:
- Starts only once the decision count passes the threshold Don sets (default 3,000).
- Validation scores use only data after each model's training window.
- It stays off unless it improves expectancy or drawdown on validation and holdout.

### Phase 6 — forward paper trading, promotion UI, Quinn routes

Build: a job that applies champion and paper challengers to live data (end of day, and intraday for intraday setups), records simulated entries, trims and exits against live prices with the same costs; promotion page where Don compares and approves; the four read-only research routes on the Anima allowlist; rolling re-test and decay alarm.

Acceptance:
- Paper trades appear with entry, stop, size, regime and reasons; trims and exits record R.
- Paper results use the same metrics as backtests, side by side.
- Promotion needs Don's click; the previous champion is kept and can be restored.
- Anima can read all four routes through the gateway; any write or non-listed research route returns 403 or 405.
- The matching `knowledge/common.md` entries are ready for Anima to add.

## 14. Out of scope

- Placing orders (Alpaca paper or live). See `docs/proposals/alpaca-trading-plan.md`.
- Changing the price vendor. Alpaca SIP is the price source.
- Fine-tuning the general LLM.
- Editing the Anima repo.

## 15. Open questions for Don

Answered and written into the spec: the 7× trim trigger (section 4), the VIX-to-trim mapping and trail thresholds (found by the backtest, section 4), entry timing (section 7), and the universe (every Nasdaq-listed common stock plus the S&P 500, section 7). Still open:

1. **Waiting entries.** When the logical stop is more than 5% away, skip or wait? If wait, for how many sessions?
2. **Account risk and positions.** Account risk per trade (0.5%, 0.75% or 1% of equity), maximum open positions, and maximum position size?
3. **Setup definitions.** Which drafts in section 3 are right, which thresholds change, what is missing? Is the market filter SPY, QQQ, or both?
4. **Missing data budget.** Pay for delisted-name history and point-in-time earnings and news if Alpaca and Finnhub can't cover them? What monthly budget for that and for LLM calls?
5. **Benchmark and promotion bar.** Judge against SPY, QQQ, or both? Minimum improvement in expectancy, maximum allowed drawdown increase, and paper period length (default 8 weeks or 20 trades)?
6. **LLM.** OK to use the OpenAI models MarketFlow already uses, at temperature 0? Any news sources to include or exclude?
7. **Discord ideas.** Start logging Discord room ideas now so they can become a feature later?
