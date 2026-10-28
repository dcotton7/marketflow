# Strategy research loop — design spec

Status: **DESIGN ONLY. No code yet.** Don approved the shape of this design; the rule thresholds in section 2 and the open questions in section 12 need his answers before phase 1 starts.
Written: 2026-10-28. Owner: Don.

## Goal

Turn Don's swing-trading method (Weinstein stage analysis, cup-and-handle and base breakouts, relative strength, volume) into a strategy MarketFlow can test honestly, explain trade by trade, and improve in small, reviewed steps. Code computes the facts and applies Don's rules. An LLM judges only what code can't. Nothing is promoted without beating the current strategy on data it never saw, then on forward paper trades, and then Don's approval.

This spec does not place orders. Real or Alpaca paper orders stay governed by `docs/proposals/alpaca-trading-plan.md`, which is planning only. "Paper trading" here means MarketFlow records simulated entries and exits against live prices.

## 1. What exists today

What this builds on, and what is missing.

| Area | Exists | Where |
| --- | --- | --- |
| Daily bars | Alpaca SIP, split-adjusted (not dividend-adjusted), one row per symbol and date | `historical_bars`, `server/data-layer/daily-bars.ts` (`getDailyBars`), `server/data-layer/daily-bar-refresh.ts`, `server/alpaca.ts` |
| Stored MAs | Current values only (EMA 10/20, SMA 20/50/200), no history | `ticker_ma`, `server/data-layer/moving-averages.ts` |
| Indicator library | SMA/EMA, MA slope and stacking, volume vs average, volume dry-up, up/down volume, ATR, ATR %, base detection, base depth, base count, distance from 52-week high, breakout detection, VCP tightness, RS vs index, RS score, RS line new high, RSI, MACD | `server/bigidea/indicators.ts` (`INDICATOR_LIBRARY`) |
| Point-in-time technicals | Indicators "as of" a past date | `server/sentinel/technicals.ts` (`fetchHistoricalTechnicalData`) |
| Setup detectors | Breakout, VCP, long base, HVC, undercut and rally, gap and go, ORB | `shared/setup-detectors/` |
| Stage logic | Wyckoff phases (accumulation, markup, etc.), not Weinstein | `server/market-condition/analysis/modules/wyckoffStage.ts` |
| Position sizing | Fixed $100k account, 1% risk, 1.5 ATR stop | `server/market-condition/analysis/modules/positionSizing.ts` |
| Outcome tracking | Intraday scanner outcomes with exact 5-minute checkpoints, episode dedupe | `server/scanner/outcome-tracker.ts`, `shared/scanner-outcome-v3.ts`, `scanner_discoveries` |
| Holdout and cost gate | Weekly chronological stability, net edge after round-trip cost, liquidity floor | `shared/scanner-evidence-holdout.ts`, `docs/signals-lab-evidence-contract.md` |
| LLM calls | OpenAI (`gpt-5.1`, `gpt-4o`, `gpt-4.1-mini`), temperatures 0 to 0.7 | `server/market-condition/analysis/synthesis/`, `server/scanner/routes.ts`, `server/bridge/discord-summary.ts` |
| LLM cache | One row per symbol, 3 market days, overwritten on rerun | `marketflow_analysis_cache`, `server/market-condition/analysis/cacheService.ts` |
| Earnings and news | Finnhub earnings calendar (today forward 90 days), past surprises, company news | `server/finnhub.ts`, `analysis/modules/earnings.ts`, `analysis/modules/news.ts`, `scanner/lenses/earnings-proximity.ts` |
| Universe | Today's S&P 500, Russell 2000, and a 2020 Russell 3000 list from GitHub CSVs, plus theme clusters | `server/universe/constituents.ts`, `server/market-condition/universe.ts` |
| Delisted names | Removed from the universe and persisted as excluded | `server/market-condition/utils/delisted-ticker-registry.ts`, `data/delisted-symbols.json` |
| Discord relay | Room messages held in memory on Live only, lost on restart | `server/bridge/discord-relay.ts` |
| Anima access | Read-only gateway with a route allowlist, embed cookie for framed pages | `server/middleware/animaGateway.ts` (`ALLOWED`), `server/middleware/animaEmbed.ts`, `server/middleware/dataAccess.ts` (`RULES`) |

### Gaps this spec must close or work around

- **No Weinstein stage, no 30-week MA, no weekly bars.** Weekly bars must be built from daily bars (week ending Friday, or the last session of the week).
- **No cup-and-handle detector.** The base and breakout indicators are a start; the handle needs new code.
- **RS in the scanner is one-day only.** `scanner/lenses/relative-strength.ts` compares today's change to SPY. Multi-week RS exists only in the BigIdea indicators, against SPY, not QQQ.
- **No daily-bar backtester.** The outcome tracker measures intraday scanner signals forward; nothing replays history day by day with entries, stops and position sizing.
- **`ticker_ma` is not point-in-time.** Backtests must compute MAs from `historical_bars` for each date.
- **Survivorship bias.** The universe is today's lists, and delisted names are actively purged. Names that failed in the past are missing from both the universe and `historical_bars`. Backtests on this data will look better than reality.
- **No point-in-time earnings or news.** The earnings module asks Finnhub for dates from today forward. Historical earnings dates (and when they were announced), and news as it was known on a past date, need to be checked against the vendor plan or bought.
- **Dividends.** Bars are split-adjusted only. Fine for price patterns; buy-and-hold benchmarks should add dividends or the comparison flatters the strategy by roughly SPY's yield.
- **LLM cache overwrites.** `marketflow_analysis_cache` keeps one row per symbol. Verdicts for research need their own table that is never overwritten.
- **Discord ideas are not stored.** They can't be a backtest feature. They could be logged going forward if Don wants them as a feature later.
- **LOCAL and LIVE share one database** (noted in the Alpaca plan). Research tables written by jobs on Don's PC appear on Live at once. That is useful (Live and Quinn can read results) but heavy jobs must not run on Render, which already runs a memory gate (`server/infra/memory-gate.ts`).

## 2. Layers

Four layers. Each one only does what the layer below can't.

### Layer A — facts (code)

Computed for every symbol and every date from `historical_bars`, as of that date's close, never using later bars:

- Moving averages: 10/21 EMA, 50/150/200 SMA daily; **10-week and 30-week SMA on weekly closes** (the 30-week MA drives Weinstein stages).
- MA slope: 30-week MA change over the last 4 weeks, in percent.
- RSI(14), MACD(12,26,9) and histogram.
- ATR(14) and ATR as percent of price.
- Relative volume: today's volume over the 50-day average; weekly volume over the 10-week average.
- Relative strength vs SPY and vs QQQ: return difference over 63 and 126 days, Mansfield RS (stock/index ratio vs its own 52-week average), RS line distance from its 52-week high, and an RS percentile rank within the universe.
- Distance from the 52-week high and from the all-time high in the data.
- Base and pattern facts: base start, length, depth, pivot, handle (start, depth, length, volume), prior uptrend into the base.
- Average daily dollar volume (20-day) and price.
- Market facts: SPY and QQQ stage, and the share of the universe above its 30-week MA (point-in-time breadth).
- Earnings date facts **when a point-in-time source exists** (days to next earnings, days since last).

Reuse the math in `server/bigidea/indicators.ts`, `shared/ma-math.ts` and `shared/setup-detectors/` where it fits. Wrap it in one pure function per fact that takes bars up to a date, so live and backtest use the same code.

Position sizing is a fact too: `shares = floor(equity × risk% ÷ (entry − stop))`, with fixed risk between 0.5% and 1% of equity, and a cap on position size as a share of equity. This replaces the fixed $100k assumption in `positionSizing.ts` for research.

### Layer B — Don's rules (code, pass/fail)

Every rule is an explicit check with a name, a threshold, a pass/fail result and the measured value, so a decision can say "failed `volume_breakout`: 1.2× vs 1.5× required". The list below is a **draft for Don to confirm or change**. Numbers are common starting points, not his.

**Market filter**
- [ ] `market_stage`: SPY (or QQQ, Don to pick) closes above its 30-week MA and the MA is not falling. Otherwise no new longs.

**Stage 2 (Weinstein)**
- [ ] `above_30w`: weekly close above the 30-week SMA.
- [ ] `ma30w_rising`: 30-week SMA higher than 4 weeks ago.
- [ ] `stage1_base`: before the breakout, at least 8 weeks where the 30-week MA was flat (change within ±2% over 8 weeks) and price crossed it more than once.
- [ ] `stage2_breakout_volume`: breakout week volume at least 2× the 10-week average.
- [ ] `not_extended`: close no more than 25% above the 30-week MA, and no more than 5% above the pivot at entry.
- [ ] `mansfield_rs_positive`: Mansfield RS vs SPY above zero and rising.

**Base breakout**
- [ ] `base_length`: at least 5 weeks (25 sessions).
- [ ] `base_depth`: 8% to 35% from base high to base low.
- [ ] `near_high`: pivot within 15% of the 52-week high.
- [ ] `breakout_close`: daily close above the pivot.
- [ ] `volume_breakout`: breakout-day volume at least 1.5× the 50-day average.
- [ ] `volume_dryup`: the last 5 sessions before breakout average under 0.8× the 50-day average.

**Cup and handle**
- [ ] `prior_uptrend`: at least 30% rise into the left lip.
- [ ] `cup_length`: 7 to 65 weeks.
- [ ] `cup_depth`: 12% to 35%.
- [ ] `rounded_bottom`: at least 3 weeks spent in the lower third of the cup (rejects V shapes).
- [ ] `handle_position`: handle low in the upper half of the cup.
- [ ] `handle_depth`: 12% or less.
- [ ] `handle_length`: at least 5 sessions.
- [ ] `handle_volume`: handle average volume below the 50-day average.
- [ ] `pivot`: entry trigger at the handle high plus $0.10.

**Relative strength**
- [ ] `rs_rank`: RS percentile at least 80 in the universe.
- [ ] `rs_line_high`: RS line vs SPY within 5% of its 52-week high.
- [ ] `rs_vs_qqq`: 63-day return above QQQ's.

**Liquidity**
- [ ] `price_min`: close at least $10.
- [ ] `dollar_volume_min`: 20-day average dollar volume at least $20M.

**Risk and exits**
- [ ] `stop`: below the handle or base low, or entry − 2 ATR, whichever is closer; reject if the stop is more than 8% below entry.
- [ ] `risk_pct`: 0.5% to 1% of equity per trade (one value per strategy version).
- [ ] `max_position`: no position over 20% of equity; at most N open positions.
- [ ] `exit`: first of stop hit, target (2R or 3R), trailing exit on a weekly close below the 10-week MA, or the Weinstein exit (weekly close below the 30-week MA).
- [ ] `earnings_gap`: no new entry within 5 sessions before earnings (code when the date is known point-in-time; otherwise the LLM layer judges it).

A setup is a **candidate** when it passes the market filter, liquidity, and either the base breakout or the cup-and-handle group, plus Stage 2 and RS. Each strategy version says which groups are required.

### Layer C — context judge (general LLM)

Runs only on candidates (a small share of the universe), so cost stays bounded. It judges what code can't:

- Earnings timing when no structured date exists, and whether a recent report helped or hurt the setup.
- Catalyst quality: real business news (contract, guidance, product) vs noise.
- Contradicting news: offering, lawsuit, downgrade, accounting issue, pending acquisition (a capped upside).

Rules for this layer:

- Low temperature (0 to 0.2), fixed model id, fixed prompt version.
- Input: the code facts plus headlines and earnings info **known as of the decision date**, anonymized (section 5).
- Output is structured: `verdict` (`take` / `skip` / `caution`), `confidence` (0 to 1), `reasons` (short list), `flags` (e.g. `earnings_within_5d`, `offering`).
- Every verdict is saved with its reasons and never overwritten. Same input, same prompt version and same model means the cached verdict is reused, not re-asked.
- It can only veto or downgrade a candidate. It never creates trades code didn't find.

### Layer D — specialist signal (optional, tested separately)

A narrow model that adds one number, for example news sentiment (FinBERT-style) on the same headlines, or a pretrained time-series forecaster. It is a feature, not a judge. It gets its own ablation (section 4) and the same contamination checks as the LLM (pretrained models also saw history). It ships only if it adds measurable edge on top of rules and the LLM. The existing `analysis/modules/sentiment.ts` is a starting point to compare against.

## 3. Strategy as a versioned package

A strategy is one immutable package. Changing anything makes a new version.

| Part | Contents |
| --- | --- |
| `id` | e.g. `wein-cwh-v7` plus a content hash |
| `parent_id` | the version it was derived from |
| `rules` | which rule groups are required, and every threshold |
| `params` | risk %, max positions, exit choice, cost model, universe id |
| `llm` | model id, its knowledge cutoff, prompt text, prompt version, temperature, on/off |
| `specialist` | model id and version, on/off |
| `learned_model` | trained model file id and its training window, on/off |
| `created_by` | `don`, `critic`, or `manual` |
| `change_note` | plain words: what changed and why |
| `status` | `draft`, `challenger`, `paper`, `champion`, `retired` |

Stored in a new table (e.g. `strategy_versions`) with the package as JSON and the hash unique. Prompts and model files are stored by hash so old versions can always be re-run exactly. Exactly one version is `champion` at a time.

## 4. Evaluation harness

One backtester for every strategy version. It runs on Don's PC as a script (like `scripts/`), not on Render, and writes results to the shared database.

### Point-in-time only

- On each date, only bars, earnings dates and news available by that day's close may be used. Signals form at the close; entries happen on the next session (at the open, or at the pivot if price trades through it, with gaps filled at the open).
- MAs, RS ranks and breadth are computed from `historical_bars` as of each date, never from `ticker_ma`.
- The universe on each date is the universe **as of that date** (see survivorship below).
- A test asserts that shifting all future bars changes no past decision.

### Costs

- Commission: $0 (configurable).
- Slippage: 10 bps per side for names over $50M daily dollar volume, 25 bps under that, plus the gap when a stop or entry is jumped. Same idea as `evaluateCostSensitivity` in `shared/scanner-evidence-holdout.ts`, applied per trade.
- Results are always reported net of costs.

### Walk-forward windows

Alpaca daily history starts in 2016, so roughly ten years are available.

- **Locked holdout:** the most recent 12 months. Never used for tuning. Checked rarely (section 6).
- **Walk-forward on the rest:** tune on 3 years, validate on the next 6 months, roll forward 6 months, repeat. Report each validation window separately and combined.
- Every window reports its market regime (SPY stage, trend up/down/sideways) so results can be read by regime.

### Metrics

Per run, per window, net of costs:

- Trade count (and trades per year). Results under 30 trades are labelled "too few to judge".
- Win rate.
- Expectancy per trade in R (average R-multiple) and in percent.
- Average win R, average loss R, profit factor.
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

- Build a point-in-time universe: which symbols were listed and eligible on each date, including ones later delisted, merged or bankrupt. This needs bars for dead names, which `historical_bars` doesn't have and `delisted-ticker-registry.ts` deliberately removes.
- Options, cheapest first: (a) check how far Alpaca serves bars for inactive assets; (b) free historical S&P 500 membership lists, limiting the first universe to S&P 500 names as they were; (c) a paid survivorship-free dataset (open question).
- Until that exists, every report carries a "survivorship-biased universe" warning, and promotion decisions compare versions against each other on the same biased universe (the bias is roughly shared), never against absolute targets.
- The delisted registry stays as is for the live app. Research gets its own universe table so the live purge doesn't erase research history.

## 5. LLM lookahead contamination

A general LLM may remember what happened to a stock after the decision date ("NVDA in May 2023"). That makes its backtest verdicts look smarter than they are. Mitigations, all required:

- **Anonymize inputs.** Replace ticker and company name with a token (`STOCK_A`), strip or generalize product and executive names in headlines where possible, shift all dates to relative days ("day 0", "earnings in 4 sessions"), and send prices as percentages from the pivot rather than dollar levels. Keep the sector in broad words only.
- **Leak probe.** Before trusting a prompt, ask the model to name the anonymized stock or its later return on a sample. If it identifies more than chance, the anonymization is not good enough.
- **Post-cutoff testing only.** Each package records its model's published knowledge cutoff. The LLM layer's ablation result counts only on decision dates after that cutoff plus a 3-month margin. Earlier dates may be run for debugging, but their numbers are labelled contaminated and never used for promotion.
- **The sample will be small.** Post-cutoff windows for current models cover a year or two at most, and part of that is the locked holdout. Expect few trades and treat LLM-layer evidence as weak until forward paper trading confirms it.
- **Forward paper trading is the true test** (section 6). No model can remember the future.

Code rules and the learned model have no memory of history, so their backtests don't need this guard. The specialist model does, if it is pretrained.

## 6. The improvement loop

### Champion and challengers

- The **champion** is the current approved version. Everything else is a challenger.
- Each **round** produces N challengers (default 5) from the champion.

### The critic

A separate LLM call (the critic) reads the champion's decision log for the latest validation window, focused on:

- Losing trades, with their facts, rule results and LLM reasons.
- Skipped candidates that would have won (missed trades).
- Rule checks that barely passed or barely failed.

It proposes **concrete diffs**, each with a one-line reason tied to logged trades:

- A threshold change (`volume_breakout` 1.5× → 1.8×).
- A new filter built from existing facts (skip if ATR % over 6).
- A prompt edit for the context judge.
- A new fact to compute (handle volume trend).

The critic may only use facts that exist point-in-time. It never sees the holdout.

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
- Spend per round is stored with the round's results.

## 7. Learning data

### Decision log

Every candidate the strategy evaluates (taken or skipped), in backtest, paper and live, gets one row in a new table (e.g. `strategy_decisions`):

- Strategy version id, run id, mode (`backtest`, `paper`), symbol, decision date.
- All layer A facts as of that date.
- Every rule result with its measured value.
- LLM verdict, confidence, reasons and flags (by reference to the saved verdict).
- Specialist score, learned-model score (when present).
- Decision: taken or skipped, and why.
- Planned entry, stop, target, size.
- Outcome: target hit before stop (yes/no), R-multiple at exit, max favorable and adverse excursion in R, days held, exit reason.

Skipped candidates are labelled too ("what would have happened"), so filters can be judged on what they removed.

### Learned model

- Once there are several thousand labelled decisions, train a simple model (gradient boosting) on layer A facts to score setups: probability of target before stop, or expected R.
- Trained only on walk-forward training windows; evaluated like any other layer, with its own ablation.
- Saved by file hash in the strategy package with its training window.
- Feature importance is reported so Don can see what it leans on.

The general LLM stays the context judge and explainer. It is not fine-tuned on returns: the sample is too small, the result can't be explained, and it would deepen the contamination problem.

## 8. Regime change

- **Rolling re-test:** each month, re-run the champion on the latest 6 and 12 months and compare to its own history.
- **Decay alarm:** if rolling 6-month expectancy in R falls below a set floor (e.g. under 0.1R) or drawdown exceeds its worst backtest drawdown by a margin, flag it on the research page.
- **Retirement:** a flagged champion is reviewed by Don. Options: keep, reduce risk %, pause (no new paper entries), or retire and promote the best challenger that passes the gates. Retired versions stay stored and re-runnable.
- Results are always shown split by market regime (SPY stage) so a strategy that only works in Stage 2 markets is visible as such.

## 9. Quinn (Anima companion) integration

MarketFlow is the source of truth. Anima reads it read-only through the existing gateway (`/api/anima/<path>` runs `GET /api/<path>` as the owner). No research data is copied into Anima.

### New read-only routes

All are plain reads of stored results. None runs a backtest, calls an LLM, or writes anything. The gateway already drops `force` and `refresh`; these routes take neither.

| Route | Returns |
| --- | --- |
| `GET /api/research/champion` | Current champion id, when promoted, its rules in plain words ("Stage 2: weekly close above a rising 30-week average…"), risk %, and its headline backtest and paper numbers |
| `GET /api/research/rounds/latest` | Latest round: challengers tried, what each changed, validation results, whether the holdout was checked, outcome, spend |
| `GET /api/research/decisions/:id` | One decision: symbol, date, facts, each rule pass/fail with values, the saved LLM verdict and reasons, outcome |
| `GET /api/research/paper/performance` | Paper trading for champion and challengers in paper: open and closed trades, win rate, expectancy in R, drawdown, vs SPY/QQQ |

Wiring, when each route ships:

- Add the route to `ALLOWED` in `server/middleware/animaGateway.ts` (e.g. `^/api/research/(champion|rounds/latest|decisions/\d+|paper/performance)$`) with a test in `animaGateway.test.ts`.
- Add an `owner` rule in `server/middleware/dataAccess.ts` for `/api/research/`, since results are computed from licensed vendor data.
- Write routes (start round, approve promotion) stay off the allowlist and stay `owner_admin`.
- Anima's own client code needs a matching read. That is Anima-side work, not part of this repo.

### Quinn's knowledge

Anima's `knowledge/common.md` gets a short entry **only when each piece ships**, so Quinn knows the concepts and limits without claiming abilities that don't exist. This spec does not edit the Anima repo. Draft wording per piece:

- **Phase 1 shipped:** "MarketFlow can backtest Don's swing rules (Weinstein Stage 2, base and cup-and-handle breakouts, RS, volume) on past daily bars. Results are biased upward because past delisted stocks are missing. You can't see or run backtests yet."
- **Phase 3 shipped:** "Some strategy versions use an AI check on news and earnings before a trade. Its reasons are saved. Backtest results for it only count after the AI's training cutoff."
- **Phase 4 shipped:** "MarketFlow tests improved versions of Don's strategy in rounds. Don approves any change; nothing switches on its own."
- **Phase 6 shipped:** "You can read the current champion strategy and its rules, the latest round, why a given trade was taken or skipped, and paper-trading results. These are paper results, not real trades. You can't change the strategy, run tests, or place trades, and you don't give buy or sell advice."

## 10. Phased build plan

Each phase ships on its own and is usable before the next starts.

### Phase 1 — facts, rule checks, point-in-time backtest

Build: weekly bars from daily; layer A facts as pure functions over bars up to a date; Don's confirmed rules as named pass/fail checks; the backtester with costs, sizing, walk-forward windows and metrics; `strategy_versions` with the first version.

Acceptance:
- Facts match hand-checked values on 5 symbols across 3 dates (including the 30-week MA and Stage 2 call on a known chart Don picks).
- The lookahead test passes (changing future bars changes no past decision).
- A full walk-forward run on the chosen universe finishes on Don's PC, reports every metric net of costs, and shows SPY/QQQ buy-and-hold for the same windows.
- Re-running the same version gives identical results.
- Reports carry the survivorship warning until the point-in-time universe exists.

### Phase 2 — decision log

Build: `strategy_decisions` for every candidate, taken or skipped, with outcome labels; a research page in MarketFlow that lists runs and decisions with filters.

Acceptance:
- Every trade in a backtest has a decision row with facts, rule results and outcome; counts match the backtest's trade count.
- Skipped candidates have "would have" outcomes.
- Don can open any decision and see why it was taken or skipped in plain words.

### Phase 3 — LLM context verdict with contamination guards

Build: the context judge on candidates; anonymizer; leak probe; verdict table and cache; budget; ablation rules only vs rules + LLM, scored only after the model's cutoff.

Acceptance:
- Leak probe identifies anonymized stocks no better than chance on a 100-case sample.
- Second run of the same backtest makes zero new LLM calls (all cached).
- Spend per run is reported and a run stops cleanly at its budget.
- The ablation report shows pre-cutoff results labelled contaminated and excluded.

### Phase 4 — critic, champion/challenger, holdout

Build: rounds, critic proposals as diffs, N challengers per round, promotion gates including deflated Sharpe and the holdout check limit, variant counter.

Acceptance:
- A round produces N challengers, each with a readable diff and reason tied to logged trades.
- The holdout can't be checked more often than the limit; every check is logged.
- No challenger reaches `paper` without passing validation and the multiple-testing gate.

### Phase 5 — learned model

Build: training job on labelled decisions (walk-forward windows only), model stored by hash, ablation with and without it, feature importance report.

Acceptance:
- Starts only once the decision count passes the threshold Don sets (default 3,000).
- Validation scores use only data after each model's training window.
- It stays off unless it improves expectancy or drawdown on validation and holdout.

### Phase 6 — forward paper trading, promotion UI, Quinn routes

Build: daily job that applies champion and paper challengers to the latest close, records simulated entries and exits against live prices with the same costs; promotion page where Don compares and approves; the four read-only research routes on the Anima allowlist; regime re-test and decay alarm.

Acceptance:
- Paper trades appear the next session with entry, stop, size and reasons; exits record R.
- Paper results use the same metrics as backtests, side by side.
- Promotion needs Don's click; the previous champion is kept and can be restored.
- Anima can read all four routes through the gateway; any write or non-listed research route returns 403 or 405.
- The matching `knowledge/common.md` entries are ready for Anima to add.

## 11. Out of scope

- Placing orders (Alpaca paper or live). See `docs/proposals/alpaca-trading-plan.md`.
- Intraday strategies. The existing scanner evidence work (`docs/signals-lab-evidence-contract.md`) stays separate.
- Fine-tuning the general LLM.
- Editing the Anima repo.

## 12. Open questions for Don

1. **Data vendor and budget.** Keep Alpaca bars and Finnhub as is, or pay for survivorship-free history (delisted names) and point-in-time earnings dates and news? What monthly budget for data, and what for LLM calls?
2. **Universe.** S&P 500 only to start (easiest to make point-in-time), S&P 500 + Russell 2000, or the full Russell 3000? Minimum price and dollar volume?
3. **Holding period.** Typical hold you want to test: a few weeks (exit on 10-week MA or 2–3R) or months (Weinstein exit on the 30-week MA)? Or both as separate strategies?
4. **Risk per trade.** 0.5%, 0.75% or 1% of equity? Max open positions and max position size?
5. **Rules.** Which of the draft checks in section 2 are yours as written, which thresholds change, and what is missing? Is the market filter based on SPY, QQQ, or both?
6. **Entry and exit mechanics.** Buy at the next open after a breakout close, or a buy-stop at the pivot? Stop at the base or handle low, an ATR stop, or the tighter of the two?
7. **Benchmark.** Judge against SPY, QQQ, or both? Does a strategy need to beat buy-and-hold, or is lower drawdown at similar return enough?
8. **Promotion bar.** Minimum improvement in expectancy, maximum allowed drawdown increase, and paper period length (default 8 weeks or 20 trades)?
9. **LLM.** OK to use the OpenAI models MarketFlow already uses, with temperature 0? Any news sources to include or exclude?
10. **Discord ideas.** Start logging Discord room ideas now so they can become a feature later?
