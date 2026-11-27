# Trigger scanner (off by default: `TRIGGER_SCANNER=on`)

An always-on scanner that runs during the regular session over the whole liquid universe. It raises a candidate when
the trigger happens, on the close of a 5-minute bar. It puts a stop at a logical level, grades the candidate by code
and stores it append-only. The result is a **pass list** served read-only through the Anima gateway. There is no
model anywhere in it. Each person's own AI reads the pass list and picks the short list (Don, 26 Nov: "run the scan
in marketflow and the AI analysis on the short list or pass list into each persons AI").

Code: `server/trigger-scanner/`. Setups: the seven intraday triggers below, gap and go, Leader Shakeout, and users' own. Tables: `migrations/029_trigger_scanner.sql`. Tests: `npm run test:trigger-scanner`.
Replay: `npm run trigger:replay -- [fixture.json] [--grade=A,B|all] [--json]`.

## The flag and what it changes

The flag is `TRIGGER_SCANNER=on`. It is unset in the repo.

**When the flag is unset:**
- `startTriggerScanner` returns at once. No timer starts, no query runs, no table is created.
- `GET /api/triggers` and `GET /api/triggers/status` answer 404, through the gateway too.

**Other settings** (environment; a bad value keeps the default):

| Setting | Default | Controls |
|---|---|---|
| `TRIGGER_SCANNER_TIER` | `bars` | Which tier runs; `shortlist` is the fallback tier |
| `TRIGGER_SCANNER_FEED` | `sip` | The bar feed (`iex` is the alternative) |
| `TRIGGER_SCANNER_MIN_PRICE` | 6 | Universe floor: last close |
| `TRIGGER_SCANNER_MIN_DOLLAR_VOL` | 30000000 | Universe floor: 20-day average dollar volume |
| `TRIGGER_SCANNER_SHORTLIST_MAX` | 300 | Names given bars in the shortlist tier |
| `TRIGGER_SCANNER_MAX_PER_DAY` | 5000 | Candidates stored a day |

Every trigger threshold is in `settings.ts` `DEFAULTS`. `RULE_VERSION` (`ts-2026-11-26-v2`; v2 added gap and go) is stored on every row,
so a later change to a threshold never changes the meaning of stored rows.

**Lines changed outside the new folder:**
- `server/routes.ts`: mounts `/api/triggers`.
- `server/index.ts`: calls `startTriggerScanner()`.
- `server/middleware/dataAccess.ts`: `/api/triggers` is `owner` level, because it is built from vendor bars.
- `server/middleware/animaGateway.ts`: allow-list entry `/api/triggers(/status)?`, GET only.
- `package.json`: two scripts.

## What exists in MarketFlow and what the scanner uses

| Need | What is there (read in the code) | Used how |
|---|---|---|
| Universe | Theme universe (static lists plus `tickers`, about 1,041 names) and the scan pool (`scan_pool`, FMP screener weekly, at least $1B cap, $6 and $30M a day; about 711 more). Both are merged by `data-layer/bar-universe.ts` `loadBarUniverse`. The Anitir spec counts about 1,746 names at $6 / $30M | `loadBarUniverse`, then the floor applied again on the stored daily bars. The 16 size and sector ETFs are added |
| Daily bars | `historical_bars` (theme plus pool), written by the daily bar job. `getDailyBarsBatch` merges today's snapshot bar into the series | The scanner reads finished sessions only (`bar_date < today`), once a day, in chunks of 200 symbols |
| 5-minute bars | **Not held universe-wide.** `data-layer/intraday-bars.ts` fetches per symbol on demand (an LRU cache of about 80 entries) for charts. BigIdea pulls 60 days per symbol per scan | New: the multi-symbol bars endpoint, incremental (below). Today's bars only |
| Quotes | `market-condition/engine/snapshot.ts`: Alpaca `/v2/stocks/snapshots`, 100 symbols a request, every 60 s in market hours (`DEFAULT_CADENCE`), theme-universe names only (pool names are not polled). Each snapshot has price, open, day high/low, volume, VWAP (`dailyBar.vw`), prevClose, prev day high/low | The fallback tier's quote checks (`getRawSnapshotsForScanner`); no extra calls |
| Regime | `engine/rai.ts` `getCachedRAI()`: label AGGRESSIVE / NEUTRAL / DEFENSIVE, score, `calculatedAt` | Read at each pass, no recompute |
| Size / sector | `tickers.market_cap_size` (`utils/cap-size.ts`), `tickers.sector`, `scan_pool.sector` / `market_cap` | Loaded once a day |
| Earnings | `earnings/upcoming.ts`: `earnings_estimates_daily`, a market-wide Finnhub calendar pulled daily for 91 days | The next report date per name, used when the newest pull is at most 7 days old; otherwise "earnings date not checked: 0" |
| Daily setups | `setups/*`: Leader Shakeout hits in `setup_leader_shakeout` (after the close) | Hits of the last 5 sessions are watched for "coming into range" |
| Guards | `infra/memory-gate.ts` (night mode 20:00-04:00 ET and weekends; pressure = heap over 70% of `HEAP_LIMIT_MB` or RSS over 72% of `RSS_BUDGET_MB`), `infra/job-guard.ts` (`guardTrippedToday` after a heavy job hit `JOB_RSS_LIMIT_MB`) | The scanner pauses on any of them and says so |
| Reused code | `setups/daily-math.ts` `smaAt` (SMAs); `setups/grades.ts` `gradesWanted` (the `grade=` filter); BigIdea `INDICATOR_LIBRARY` (user setups, daily only); `shared/chart-indicators.ts` `calculateSessionVwap` | VWAP uses the same formula. A test checks the two agree; it is not called directly because it formats an ET date per bar, too slow for 136k bars a pass |

The Alpaca plan limits were **not verified**: there are no keys here. The app already uses `feed=sip` for snapshots
and daily bars, which suggests a SIP-entitled plan. Alpaca documents 200 requests a minute on the free tier and far
more on paid tiers.

## How bars reach the scanner

**Chosen: the multi-symbol bars endpoint, incremental.** The request is
`GET /v2/stocks/bars?symbols=A,B,...&timeframe=5Min&feed=sip`. It is the same endpoint and keys `alpaca.ts`
already uses for daily bars, called by `bars-feed.ts`.

**Timing:** each pass runs 20 s after a 5-minute boundary (`barSettleSec`). It asks only for the bars since the last
fetch, plus the last bar again in case it arrived late. Only closed bars are kept.

**Request arithmetic:**

| Case | Requests |
|---|---|
| Per pass (1,750 names in batches of 200) | 9 |
| Full session (78 passes) | about 700 a day, about 2 a minute |
| Restart mid-day (catch up the day so far: 1,750 x 78 = 137k bars at 10,000 a page) | about 18, once |
| Existing snapshot loop, for comparison (about 1,100 names / 100 a request, every 60 s) | about 11 a minute, about 4,300 a day |

So the scanner adds about 16% to the app's Alpaca calls.

**Memory arithmetic:**
- Bars: today's bars only, 78 a name, about 200 bytes each as JS objects (the BigIdea review measured this). That is
  1,750 x 78 x 200 B, about 27 MB at the close.
- Daily contexts: about 2 KB a name, about 3.7 MB; the trend facts add about 1 KB a name (1.7 MB for 1,750 names,
  measured).
- Daily load (since the trend facts, 27 Nov): about 255 finished sessions (375 calendar days; was 75) in chunks of
  100 symbols (was 200), about 25k rows, about 9 MB transient a chunk (measured on synthetic rows in the pg shape:
  200 x 75 = 15k rows was 5.2 MB; 200 x 250 = 50k rows would be 17.4 MB, so the chunk was halved). The whole read is
  about 440k rows a day (was about 131k), 18 queries instead of 9, once before the open. Building 1,750 contexts with
  the trend facts takes under 100 ms.
- With users' setups: 260 sessions a chunk, about 26k rows transient.
- Never held: 60 days of 5-minute bars for the universe. The review puts that at about 2.7 GB, over the 1.5 GB heap.
- Pass time, measured on synthetic bars (1,750 names x 78 bars, every level near the price): worst pass 114-161 ms,
  4-6 s for the whole day.

**Not chosen:**
- **The minute-bar websocket.** It would need a connection manager, reconnects and 1-to-5-minute aggregation. Whether
  the plan streams the whole universe is unknown. A later option if the REST cadence proves too slow.
- **Extending the snapshot loop.** It covers theme names only, and a snapshot has no bar history, so ORB, VWAP-cross
  and close-based triggers cannot be computed from it.

**Fallback tier: `shortlist`.** It is turned on by the setting, or automatically after two failed bar fetches in a
day (for that day).
- Quote checks run universe-wide on the snapshot cache (no new calls). A name is promoted when:
  - its price is within 0.5 ADR of a daily level or of VWAP;
  - it has moved at least 1 ADR from the open;
  - its volume pace is at least 1.5x the time-of-day norm;
  - or it is a watched daily setup (always included).
- Only the promoted names get 5-minute bars, at most 300 (2 requests a pass), plus the rotation ETFs. Names promoted
  earlier in the day keep their bars.
- A promotion is not a candidate. A candidate still needs a closed bar and the same triggers.
- Pool names have no snapshot, so in this tier they are seen only when watched.

**Pauses.** The loop checks every 30 s. It pauses, writes one run row per 5-minute slot with the reason, and shows
the reason in `/status`, when:
- night mode or the weekend is on (state `closed` outside the regular session);
- memory pressure is high;
- a heavy job tripped the RSS guard today (paused until tomorrow).

While paused it fetches nothing. The next pass fetches every bar since the last fetch, so nothing is lost, only late.
The scanner does not take the heavy-job lock (`withJobLock`): it is light and must not block the daily jobs or be
blocked by them.

## Triggers

Each trigger is a pure function in `triggers/`. It reads bar `i` (the one that just closed) and earlier bars, never
later ones. Bars are regular session only: pre-market never enters VWAP or the range.

ADR is the 20-session average of high/low - 1, from finished sessions. The relative-volume norm is the 20-day average
volume spread over the 78 slots by a fixed U-shaped profile (`session.ts` `VOLUME_PROFILE`). It is modelled, not
measured. A measured per-name curve needs about 20 days of stored 5-minute history.

| Setup key | Side | Rule (defaults) | Dedupe window |
|---|---|---|---|
| `orb_breakout` / `orb_breakdown` | long / short | The range is the first `orMinutes` 15 (three bars). This bar is after the range and closes within `orbUntilMin` 120 minutes of the open. It is the **first** close above the range high (or under the low). Its volume is at least `orbMinRelVol` 1.5x the slot's norm | 1 day |
| `failed_orb` / `orb_reversal` | short / long | An earlier bar after the range closed beyond the high (low). The break reached at least `failedBreakMinAdr` 0.1 ADR beyond the range. This bar is the first close back inside | 90 min |
| `vwap_reclaim` / `vwap_loss` | long / short | Session VWAP. This bar closes across VWAP by at least `vwapMinCrossAdr` 0.05 ADR, and each of the `vwapPriorBars` 3 bars before it closed on the other side | 60 min |
| `level_hold` / `level_reject` | long / short | Daily levels: SMA 5/10/20/50, EMA 10/20, previous low/high, and gap edges whose role fits. Earlier today price was at least `levelApproachAdr` 0.3 ADR on the right side. The previous bar closed on the right side. This bar tags the level within `touchTolPct` 0.15% and closes back. One hit a bar: the level nearest the close. The variant is the level name | 120 min per level |
| `lod_reversal` / `hod_reversal` | long / short | This bar or the one before set a new session low (high), not on the first bar. The open is at least `reversalMinMoveAdr` 0.5 ADR from that extreme. This bar closes up (down), in the top (bottom) `reversalCloseShare` 60% of its range, past the previous close | 60 min |
| `new_high_volume` / `new_low_volume` | long / short | After the range, a close above every earlier high (under every earlier low). The bar's volume and the day's volume so far are both at least `newExtremeMinRelVol` 1.5x their norms | 60 min |
| `gap_and_go` / `gap_down_and_go` | long / short | A true gap (open beyond the prior high / low) on volume that has held, within `goMaxDays` 10 sessions (the gap day is day 0). The first close beyond the **pivot**: the top (bottom) of the post-gap consolidation, which may be below the gap-day high. Days 1-2 use today's opening-range high (or the gap-day high); day 0 uses the opening-range high. The close must clear it by `goBreakAdr` 0.05 ADR, on `goRelVol` 1.5x. A later close beyond the gap-day high is a second variant, `gap_high_break`. On day 0 it replaces `orb_breakout` / `orb_breakdown` on the same bar (`facts.also`). The full rule is in the next section | once per gap and variant per day; at most `goMaxFires` 2 per gap |
| `leader_shakeout` (daily in range) | long | A Leader Shakeout hit of the last 5 sessions. This bar closes within `inRangeAdr` 0.5 ADR of the drop day's close (entry level; PROPOSAL) and closes up. Tested: 2 grade points | 1 day |
| user setups (`daily_in_range`) | the setup's | Passed on last night's bars. This bar closes within the setup's `range_adr` (or 0.5) of its entry level and moves the setup's way | 1 day |

The noise guards (approach, cross size, break size) were added after a synthetic worst case: 1,750 random walks with
every daily level within 1.5% of the price. That case produced 29k candidates, and 16.6k after the guards. Real
counts are unknown until a live day; the daily cap (5,000) bounds storage.

## Gap and go (Don, 26 Nov: "add gap and GO, the GO can happen up to n-number of days after the gap up")

Code: `gap.ts`. Tests: `gap.test.ts`. Every number below is a setting in `settings.ts`.

**The gap day.** Gap days in the finished sessions are found once a day, before the open. Today's own gap is read
intraday. A session is a gap up when all of these hold:
- **Size.** The open is at least `gapMinPct` **4%** and at least `gapMinAdr` **1.0 ADR** beyond the **edge**. ADR here is
  the 20 sessions before the gap.
- **The edge.** By default it is the prior session's **high** (`gapFrom = "prior_high"`: a true gap, the open clears
  all of yesterday's trading). `gapFrom = "prior_close"` (or `TRIGGER_SCANNER_GAP_FROM=prior_close`) measures from
  the prior close instead.
- **Volume.** Day volume is at least `gapVolMult` **2.0x** the average of the `gapVolDays` **50** sessions before it
  (at least 20 are needed).
- **Close.** In the upper half of the day's range (CLV at least 0.5) and above the edge.
- **Not a split cliff** in the stored bars (`setups/daily-math.ts` `looksLikeSplit`).

On day 0 the volume test is the day's volume so far against its time-of-day norm (from the 50-day average). The
close tests use the bar just closed.

The **short mirror** opens below the prior **low** (or close) by the same amounts, closes in the lower half and
below the edge.

**`earnings_gap`** is a fact, never a requirement:
- `true` when the gap session is a reaction session of a report (bmo/dmh = that day, amc = the next, via
  `earnings/upcoming.ts` `reactionSessions`) or within `earningsWindow` **1** session after one;
- `false` when the calendar was pulled this week and has none;
- `unknown` otherwise.

**Still valid.** Today is day `d`, the number of sessions after the gap day (today counts). The gap stays valid while:
- `d` is at most `goMaxDays` **10** (`TRIGGER_SCANNER_GO_MAX_DAYS`);
- no session since has **closed** below the edge (a short: above). Intraday dips that close back above do not count.

A close through the edge kills the setup for good: the gap failed and flipped to resistance, and that gap is never
raised again. On day 0, a 5-minute close back through the edge counts as failing. The newest valid gap per direction
is the one watched.

**The GO and its level (the pivot).** Don, 26 Nov: "be smart, if its been basing for weeks at 100 and peaked on gap
day at 105, then a 102 break etc would be noteworthy". So the go level is **not** the highest high since the gap. It
fires on the first 5-minute close today beyond the pivot by `goBreakAdr` **0.05 ADR**, with the bar's relative volume
at least `goRelVol` **1.5**. Every candidate records which pivot it used, as `pivot_kind`:

| When | Pivot | `pivot_kind` |
|---|---|---|
| At least `consolMinDays` **2** sessions after the gap day | The highest high of the **post-gap** sessions (the gap day's own bar excluded). This holds whether it is below or above the gap-day high | `consolidation` |
| Same, but the top is a single-bar poke (no other high within `shelfTolAdr` **0.25 ADR** of it) that closed back under a shelf of two or more highs within 0.25 ADR of each other | The shelf; the poke is ignored | `shelf` |
| Fewer sessions since the gap (days 1 and 2 by default) | Today's opening-range high when it is under the gap-day high | `opening_range` |
| Same, but the opening range is over the gap-day high | The gap-day high | `gap_high` |
| Day 0 | The opening-range high. When `orb_breakout` would fire on the same bar only `gap_and_go` is raised, with `facts.also = "orb_breakout"` | `opening_range` |

The days 1-2 rows are a **weaker read**: there is no consolidation yet.

**The gap-day high as a second level** (variant `gap_high_break:<gap date>`). It is raised when all of these hold:
- the pivot already fired, on an earlier day or earlier today;
- the gap-day high is more than `gapHighApartAdr` **0.5 ADR** beyond the pivot;
- a later close clears the gap-day high.

It fires once per gap and counts toward `goMaxFires`.

**Repeat.** Both variants together fire at most `goMaxFires` **2** times per gap. A later fire of the pivot variant
needs a `repeatPullbackAdr` **1.0 ADR** pullback since the last fire and a higher pivot. Earlier fires and their
variants are read from `trigger_candidates`.

**Overhead and base, carried on every candidate.**
- `pivot`, `pivot_kind`, `gap_day_high` (a short: the gap-day low), and `distance_to_gap_high_adr`. That distance is
  how far the gap-day extreme sits beyond the entry: overhead that is real resistance, and the `why` line says so.
- The pre-gap base: `base_days` and `base_top` (the longest run before the gap whose range stays within
  `baseRangeAdr` **3 ADR**; the screen has no base routine, and CB-1 is too heavy), `gap_cleared_base`, and
  `from_base` (a base of at least `baseMinDays` **15** sessions that the gap cleared).
- `holds_upper_half`: the post-gap range is tight (at most 1.5 ADR) and every low stayed in the upper half of the gap
  day's range. This is the strongest form.
- `risk_from_pivot_pct`: from the pivot to the stop.
- `risk_to_cons_low_pct`: from the entry to the post-gap low, the stop Don prefers.

**The stop** is the nearest valid level (the same rule as every setup: 0.25 ADR noise floor, 5% refusal). After a
pivot break that is often the post-gap low itself, which is the low risk Don wants. The candidates are:
- the **consolidation low**: the lowest low of the sessions after the gap day through yesterday, used only when it is
  above the edge;
- today's **VWAP**;
- **today's low**;
- the **5- and 10-day SMA**;
- the **gap edge**.

The level used is stored in `stop_level`.

**Grade.** It is a built-in, untested setup: 1 point. A stop at a **tight** consolidation's low (range at most
`tightRangeAdr` **1.5 ADR** over at least `tightMinDays` **2** sessions) earns the "stop level has company" point
(`facts.company = "tight consolidation"`). The pre-gap base is **not** put into the grade: the company point is about
the stop's level, and a base is about the setup's quality. Using it would double-count with the tight-flag point.
It is carried as the `from_base` fact for the AI and for later tuning.

**Facts** (snake_case):
- the gap: `gap_date`, `gap_pct`, `gap_adr`, `vol_mult`, `gap_edge`;
- the timing: `days_since_gap`, `fire_no`, `also` (when it replaced an ORB);
- the pivot and overhead: `pivot`, `pivot_kind`, `gap_day_high`, `distance_to_gap_high_adr`, `rel_vol`;
- the consolidation: `pullback_adr` (from the best price since the gap to the worst after it, in ADR),
  `cons_range_adr`, `cons_days`, `cons_low`, `tight`, `holds_upper_half`;
- the base: `base_days`, `base_top`, `gap_cleared_base`, `from_base`;
- the risk: `risk_from_pivot_pct`, `risk_to_cons_low_pct`;
- `earnings_gap`.

**How it differs from `setups/earnings-gap-up.ts`.** That setup measures from the prior **close**, by at least 3% and
1 ATR14, needs volume at least 2x the **20**-day average, needs close > open and CLV at least 0.5, and runs on
earnings reaction days only.

This one reuses from it:
- the CLV definition;
- the split guard;
- `reactionSessions` for the earnings fact.

It differs in that it:
- measures from the prior **high** by default (4%, 1 ADR);
- uses the **50**-day volume;
- runs on any day;
- needs no close > open;
- adds the held / n-day / pivot logic.

## The stop rule

**Which level** (`levels.ts`):
- For a long, the nearest level **below** the entry that can be support. For a short, the mirror.
- Levels considered: the daily ones above; the session's VWAP, opening-range low/high (once the range is complete),
  and low/high of day through the trigger bar.
- A level closer than `minStopAdr` 0.25 ADR is inside the noise. It is skipped and the next one is taken.

**Where the stop sits:** just past the level, by `min(stopBufferAdr 0.1 x ADR, stopBufferMaxPct 0.2% of the level)`.

**Risk** is measured from the entry (the trigger bar's close) to the stop, in % and in ADR. When the nearest usable
level puts the risk over `maxRiskPct` **5%**, the candidate is **refused**. Refusals are counted per setup in the run
row, as `no_level_inside_max` (or `no_level` when there is nothing on that side at all).

**Gaps** (Don: "Filled (green) is support tested and failed (red) is resistance"; "support becomes resistance and
vice versa"). Gaps on daily bars over 60 sessions:
- A **gap up** leaves the previous high as its edge.
  - `failed`: a later close below the edge. Role: resistance.
  - `filled_held`: a later low traded into the gap with no close below the edge. Role: support.
  - `open`: never revisited. Role: support.
- A **gap down** mirrors it. A failed gap down (a later close above its edge) becomes support.
- A long's stop may sit only under a support gap; a short's only over a resistance gap.

Every other level's role comes from where it sits against the entry, so a broken level has already flipped.

**Company:** another level within `companyAdr` 0.3 ADR of the stop level, on the same side, is listed in
`facts.company` and earns the exit-logic grade point.

`server/setups/stop-levels.ts` is not reused as-is: it is long-only and daily-only, has no gaps, and picks "the first
in Don's order within 5%". The brief asks for the nearest valid level. Its definitions are kept: SMAs of closes
through the bar, and the previous day's low.

## Grade (Anitir spec 5.e, 11 points)

| Component | Points |
|---|---|
| `risk` | stop at most 1.5% or 0.5 ADR: **4**; at most 3% or 1 ADR: **2**; at most 5%: **0** |
| `exitLogic` | the stop level has company: 1 |
| `setup` | tested (Leader Shakeout): 2; built-in, untested: 1; a user's setup: 0 (until it has a record) |
| `regime` | AGGRESSIVE long or DEFENSIVE short: 2; NEUTRAL: 1; against: 0, noted; unknown: 0, noted |
| `rotation` | the name's size bucket or sector is leading: 1 |
| `liquidity` | 20-day dollar volume at least $100M: 1 |
| `earnings` | a report within 3 sessions: -2; calendar unavailable: 0, noted "earnings date not checked" |

**A** is 8 or more, **B** 5-7, **C** 4 or less. The components are stored on every row (`grade_components`), so a
retune can regrade stored rows at read time.

Note: in a NEUTRAL tape, any built-in trigger on a liquid name reaches **A** when its stop is within 1.5% and has
company. Expect many A's until `gradeA` moves or setup records exist.

**Rotation** (`rotation.ts`) uses the scanner's own bars and daily closes:
- **Size:** MGK, MDY, IWM and QQQ against SPY, today and over 5 sessions. "Hot" means ahead by at least 0.75% today
  or 2% over 5 sessions.
  - IWM or MDY hot: MID and SMALL lead.
  - MGK or QQQ hot: MEGA and LARGE lead.
  - Both or neither hot: no tilt.
- **Sectors:** the top 3 of the 11 SPDRs that are ahead of SPY, by today + 5-day / 5.

## Candidate fields (what Anitir reads)

`GET /api/anima/triggers` returns `candidates[]`, newest first. Every time is ISO UTC, and every number has an as-of:

| Field | Meaning |
|---|---|
| `id` | The cursor |
| `symbol`, `side` | `long` or `short` |
| `setup_key`, `setup_owner` | Setup key; owner is `builtin` or `user:<id>` |
| `variant` | The level or range edge, or the hit date for a daily setup |
| `grade`, `grade_points`, `grade_components` | With `notes` |
| `trigger_at` | The trigger bar's close |
| `trigger_bar` | `t` is the bar's start; `o h l c v` |
| `why` | One line, code-written |
| `entry_ref` | The trigger bar's close |
| `stop` | `{ level, level_price, price, gap }`; `gap` is `{ date, dir, state, role }` when the stop is a gap |
| `risk_pct`, `risk_adr`, `adr_pct` | Risk from entry to stop; the 20-day ADR |
| `rel_volume` | The trigger bar against its slot's norm |
| `levels[]` | `{ name, price, role }` at the trigger bar |
| `liquidity` | `{ price, avgVol20, dollarVol20, asOf }` |
| `regime` | `{ label, score, asOf }` |
| `cap_size`, `sector`, `group_leading` | Size bucket, sector, and whether either is leading |
| `rotation` | `{ asOf, leadingSize, leadingSectors }` |
| `data_as_of` | `{ bars, daily, regime, rotation, earnings }` |
| `facts` | The trigger's own numbers, plus `company` |
| `dedupe_key` | `day\|symbol\|side\|setup\|owner\|variant\|trigger time` |
| `market_date`, `rule_version` | |
| `trend` | The trend facts (below), measured, never a filter; `null` on rows stored before migration 031 |

## Trend facts (Don, 27 Nov): measured on every candidate, never a filter

His words: "setups above 50d, 200d, with no clear immediate resistance are best for longs. If not above, like to see
flatening or rising 50d, 200d, really all averages, but 200d, 50d most important then 20d. Tight MA's and basing is
also desireable. But lets have her continue to test these various setups." And: "In a recovery market though, we need
to see which stocks are recovering first and also after a market correction we will of course look at stocks below
50d etc, getting back to it, base and go is ideal of course".

So `trend.ts` measures them and stores them on each candidate (`trend`, JSONB, migration 031). **Nothing is refused,
dropped, re-graded or re-ranked for them**: the grade, the stop, the pass rules and every other field are the same
with or without them (a test runs one pass both ways and compares). Anitir carries them into her pick, her ideas,
the shadows and the scorecard split. A name with too little history gets nulls and a reason in `trend.missing`.

The daily part is computed once a day per name with the daily context (`daily.ts` -> `dailyTrend`); the rest at the
trigger (`scan.ts` -> `candidateTrend`). Every number is a setting in `settings.ts`:

| Fact | Definition | Setting (default) |
|---|---|---|
| `ma.sma20/50/200` | Simple averages of daily closes through the last finished session; `above` / `pct`: the trigger bar's close (`entry_ref`) against it | |
| `slope`, `slope_pct` | (average now / average k sessions ago - 1) x 100. k = 10 for the 20 and 50-day, 20 for the 200-day. rising / flat / falling; flat = within the band | `trendSlope20Sessions` 10, `trendSlope50Sessions` 10, `trendSlope200Sessions` 20; `trendFlat20Pct` 1, `trendFlat50Pct` 0.5, `trendFlat200Pct` 0.5 |
| `above_50_and_200`, `below_50_and_200` | Both averages known and the price on that side of both | |
| `tight` | (max - min of the 10, 20 and 50-day SMAs) / price x 100; `ok` when <= the limit | `trendTightPct` 3 |
| `base` | A **proxy**: gap.ts's `preGapBase`, the longest run of finished sessions ending yesterday whose high-low range stays within N ADR; a base when it lasts at least M sessions. Its `high`, `low`, `range_pct`, `range_adr` are given | the gap rule's own `baseRangeAdr` 3, `baseMinDays` 15 (one base definition, not two) |
| `room` | The nearest daily level in the trade's direction (above a long's entry, below a short's): the scanner's daily levels (5/10/20/50-day SMA, 10/20-day EMA, previous high/low, gap edges of the opposing role), the 200-day SMA and the 20-session high (short: low). Session levels (VWAP, opening range, high/low of day) are not counted. `dist_adr`, `dist_pct`; `clear` = none within the limit (no level at all = clear, `level` null) | `trendRoomAdr` 1 |
| `reclaim.sma20/50/200` | `dist_now_pct` / `dist_then_pct`: the last close against the average now and N sessions ago; `closing` = on the far side now and nearer than then. `date` / `sessions_ago` (yesterday = 1): the newest close back over it after at least M closes under, within the look-back; `recent` within R sessions. A short mirrors it (a close back under) | `trendReclaimCloseN` 5, `trendReclaimMinBelow` 5, `trendReclaimLookback` 40, `trendReclaimRecent` 10 |
| `vs_spy` | `off_low_pct`: last close / lowest close of the last L sessions - 1, for the name and SPY, and `vs_spy_off_low_pct` the difference; `reclaimed_50_before_spy`: the name's 50-day reclaim date before SPY's (true when only the name has one, false when only SPY, null when neither) | `trendOffLowSessions` 40 |
| `base_and_go` | Any setup: a base present and the trigger bar closing over the base high while yesterday's close was at or under it (short: under the low, from at or over it). `gap_and_go` / `gap_down_and_go`: the gap rule's own pre-gap base fact (`from_base`), so its consolidation and base logic are reused, not redefined | |
| `market` | SPY against its own 50-day: `spy_above_50`, `spy_pct_vs_50`, `spy_reclaim_50_sessions_ago`, `spy_reclaimed_50_recent`. Context for the split, not a fact about the name | |

**The short** is the mirror image of the long (below the 200 and 50-day, averages flat or falling, no support within
1 ADR below). That is the **coordinator's assumption**, not Don's words, until he confirms; the facts are side-neutral
(`above`/`below`, the slope class) except `room`, `reclaim` and `base_and_go`, which look in the trade's direction.

History: the 200-day needs 200 sessions, its slope 220, its reclaim look-back about 245; the load reads about 255.
A newer listing gets `sma200: 120 sessions, needs 200` in `missing` and nulls for those facts.

`trend.v` is 1. A changed definition gets a new `v`; the grade's `RULE_VERSION` is unchanged (no rule changed).

## Routes

**`GET /api/triggers?since=<id>&grade=A,B|all&side=long|short&setup=<key>&limit=1-500&day=YYYY-MM-DD`**
- Returns rows with `id > since`, newest first; `limit` defaults to 100 and `grade` to A,B.
- The answer carries `next_cursor` (the highest id returned) and `has_more`. Pass `next_cursor` as `since` next time;
  when `has_more` is true, ask again at once. Paging this way never skips or repeats a row (tested).
- Built-in candidates are the same for every account. Candidates of a user's setup are returned only to that account
  (`req.session.userId`; through the gateway, the gateway's owner).

**`GET /api/triggers/status`** returns:
- `running`, `state` (`starting`, `closed`, `loading`, `running`, `paused`, `error`), and `why`;
- `tier` and `tier_why`;
- `last_pass_at`, `last_bar_close`, `bars_lag_sec`;
- `universe_size`, `day_load_skipped` (floor reasons), `watching_daily_setups`, and `user_setups[]` (each running,
  or off with a reason);
- `requests_today`, `stored_today`, `over_daily_cap_today`, `fetch_failures_today`, `last_error`;
- `last_pass` (that pass's counts: names, bars, triggers, refusals, dedupes, duration, RSS);
- `regime` and the full `rotation` read;
- `today.by_setup` (by grade), `today.by_grade`, `today.total`;
- `setups[]`: the registry (key, owner, side, description, tested, dedupe window, parameters).

Example (`orb_breakout` on the invented fixture, trimmed):

```json
{ "as_of": "2026-11-24T15:00:00.000Z", "market_date": "2026-11-24", "rule_version": "ts-2026-11-26-v2",
  "since": 0, "next_cursor": 7, "has_more": true, "count": 1,
  "candidates": [{ "id": 7, "symbol": "ORBX", "side": "long", "setup_key": "orb_breakout", "setup_owner": "builtin",
    "grade": "A", "grade_points": 8,
    "grade_components": { "risk": 4, "exitLogic": 1, "setup": 1, "regime": 1, "rotation": 0, "liquidity": 1, "earnings": 0,
      "notes": ["earnings date not checked: 0"] },
    "trigger_at": "2026-11-24T14:50:00.000Z", "why": "closed 47.56 above the opening range high 47.06 on 3.84x volume",
    "entry_ref": 47.56, "stop": { "level": "vwap", "level_price": 47.1064, "price": 47.0121, "gap": null },
    "risk_pct": 1.1519, "risk_adr": 0.4011, "adr_pct": 2.9276, "rel_volume": 3.8443,
    "trigger_bar": { "t": "2026-11-24T14:45:00.000Z", "o": 47.01, "h": 47.57, "l": 46.99, "c": 47.56, "v": 206938 },
    "liquidity": { "price": 46.66, "avgVol20": 2440275, "dollarVol20": 109856480, "asOf": "2026-11-23" },
    "regime": { "label": "NEUTRAL", "score": 52, "asOf": "2026-11-24T14:45:00.000Z" },
    "cap_size": "MID", "sector": "Technology", "group_leading": false,
    "data_as_of": { "bars": "2026-11-24T14:50:00.000Z", "daily": "2026-11-23", "regime": "2026-11-24T14:45:00.000Z",
      "rotation": "2026-11-24T14:50:00.000Z", "earnings": null },
    "dedupe_key": "2026-11-24|ORBX|long|orb_breakout|builtin|range_high|2026-11-24T14:50:00.000Z" }] }
```

## Tables (append-only)

All three tables are written only with `INSERT ... ON CONFLICT DO NOTHING`. They are created by the same DDL in
`store.ts` before the first read or write, and only when the flag is on. A test scans the store, scheduler, loader,
routes and the migration for `UPDATE`, `DELETE`, `TRUNCATE`, `DROP` and `ALTER`.

| Table | Rows | Unique key | Notes |
|---|---|---|---|
| `trigger_candidates` | One per raised candidate | `dedupe_key` | About 2.3 KB a row |
| `trigger_scan_runs` | One per pass or paused slot | `pass_at` | tier, universe, names, bars, requests, lag, triggers, candidates, dedupes, refusals, skips, pause reason, duration, RSS |
| `trigger_user_setups` | One per version of a user's setup | (owner, key, version) | An edit is a new version; switching a setup off is a new row with `active = false`; the newest version is in force |

Growth: 100-1,000 candidates a day is 0.2-2.3 MB a day (the `trend` column adds about 2 KB a row). The 5,000 cap is about 11.5 MB a day at most.

## Setups: two kinds behind one interface

`registry.ts` lists every setup: key, kind (`builtin` or `user`), owner, side, description, the settings it reads,
`tested`, and the dedupe window.

- **Built-ins** are code (`triggers/*`) and are the same for every account.
- **User setups** are data per account. They are evaluated before the open, on the same daily bars, into a watch list
  of names with an entry level. Intraday they are raised by `daily_in_range` on the same 5-minute bars.

Every candidate names `setup_key` and `setup_owner`, so the record can be measured per setup. A user's private setup
is served only to its owner.

### Where setups live today (the owner's question)

- **BigIdea Thoughts** (`scanner_thoughts`, per user): a name, a category, a timeframe (`daily` or `5min`/`15min`/`30min`),
  and `criteria`. Criteria are a list of `{ indicatorId, params: [{ name, value }], inverted, muted, timeframeOverride }`
  over the 56-indicator library in `server/bigidea/indicators.ts`. All criteria must pass (AND).
- **BigIdea Ideas** (`scanner_ideas`, per user): a graph of thought nodes with AND/OR edges, plus a universe.
- **Neither carries** a side, an entry trigger ("became true on this bar"), a stop rule, a risk limit, a visibility
  or a version. They are filters, not trades.
- **The Setup Library** (`bigidea_setups` plus `bigidea_setup_indicators`) is global and admin-made. It holds
  free-text methodology, AI-extracted rules, and `ivyEntryStrategy` / `ivyStopStrategy` as label strings. Per the
  review, anyone can edit anyone's.
- **Older systems:** `pattern_rules`, `setup_confidence`, `master_setups` and `setup_variants` belong to the Pattern
  Learning page (`server/pattern-learning/*`): formulas for an AI to interpret and chart ratings. None of them is
  machine-evaluable.
- **Custom DSL indicators** (`user_indicators`) exist, but all belong to user 1 because the code reads `req.user`
  (review 3.2).

### What is built now

`trigger_user_setups` is the sidecar a BigIdea idea lacks. Each row holds:
- the owner;
- a key (a-z, 0-9 and _, 3-40 characters) and a name;
- `side`;
- the timeframe, `daily` only;
- the entry rule: `prev_high`, `prev_low` or `prev_close`;
- `range_adr`;
- `version` and `active`;
- either `idea_id` (the owner's own `scanner_ideas` row, which must be exactly ONE daily thought, owner checked) or
  inline BigIdea `criteria`.

How it is evaluated:
- Each criterion is evaluated by a pure function with the library's defaults and the stored values, `inverted`
  honoured, and an AND across criteria.
- `POST /api/bigidea/scan` and its optimizer are not in the path. The optimizer chains thoughts and changes OR
  results (review 3.2), which is why more than one thought is refused for now.

Refused at load, with the reason in `/status`:
- unknown indicators;
- intraday (`ITD-*`) and fundamental (`FND-*`) indicators;
- `CB-1`, `PA-17` and `MA-10` (too slow on 1,700 names, or needs intraday bars);
- more than 12 criteria;
- more than 10 setups per account;
- a setup that uses more than 3 s of evaluation in a day (switched off for that day).

There is no write route yet. A row is added by SQL by the owner, or by the plan below.

### The plan for the rest (not built)

1. **How a user adds one.**
   - **BigIdea UI:** build and save an idea as today. Then a new side panel adds the sidecar fields (side, entry rule,
     range, the stop preference) and writes a `trigger_user_setups` row with `idea_id`.
   - **Their AI, through the gateway:** a `define_setup` tool posts a strict body to a new
     `POST /api/triggers/setups`, added to the gateway's `ALLOWED_POSTS` / `POST_BODIES`. The body is
     `{ key, name, side, entry_rule, range_adr, criteria | idea_id }`. Unknown keys are refused. The route writes a
     new version row and never edits one. Switching a setup off is another row.
2. **Validation and limits per account.**
   - What the loader already checks, plus: parameters inside each indicator's min/max, at most 250 sessions of
     lookback, and no AI calls.
   - At most 10 active setups and 20 versions a day per account.
   - A new setup starts as `active = false` until its back-test passes.
3. **Back-test before it goes live.** Slide the evaluation over `historical_bars` for the last 250 sessions (the
   daily part is pure and cheap; the Leader Shakeout thought takes 16 ms for 1,700 names). Store each hit with 1/3/5/10-day
   forward returns and stop hits, in a new insert-only table. Refuse activation when it fires on more than 5% of
   name-days (always fires) or on none in 60 sessions (never fires). The intraday trigger part has no history to
   test until 5-minute bars are stored (piece 12 of the review).
4. **Intraday user triggers.**
   - Add session-aware indicators under **new** ids, for example ITD-4 session VWAP and ITD-5 the true opening range.
     Port the math from `server/trigger-scanner/session.ts` and the triggers. Do not reuse ITD-1/ITD-2: the review
     showed both wrong on fixed cases.
   - Add a "became true on this bar" condition (false on bar i-1, true on bar i), evaluated only on today's bars, on
     names whose daily part passed.
   - Add a stop preference chosen from the logical level names, still checked by the same stop rule and 5% refusal.
5. **Measured afterwards.** Every candidate carries `setup_key`, `setup_owner`, and through the sidecar `idea_id`
   and version. Anitir's `ideas` row records the setup it came from. The scorecard groups closed ideas by
   (owner, key, version). After 20 closed with a positive average R, a user setup earns the "tested" grade points.

## Before turning the flag on (live checks, in order)

1. Run `npm run test:trigger-scanner` on the commit. Merge it with the flag unset and confirm the deploy behaves
   exactly as before: `/api/triggers` answers 404, and no `[TriggerScanner]` line appears in the log.
2. Confirm the Alpaca plan:
   - SIP 5-minute bars for the current session without the 15-minute delay;
   - the request limit a minute;
   - that `GET /v2/stocks/bars?symbols=<200>&timeframe=5Min` answers (one manual call, owner's machine).
3. Check the database. `historical_bars` must be current for the universe (`expectedLastSession`; the daily bar job
   finished). Check whether `earnings_estimates_daily` has a pull from this week; without it, every grade says
   "earnings date not checked".
4. Turn it on for one session on a quiet day. Watch `/api/triggers/status` every few minutes:
   - `state`, `bars_lag_sec` (expect 20-60 s), `requests_today` (expect about 9 a pass);
   - `universe_size` (expect 1,600-1,800) and `day_load_skipped`;
   - `last_pass.duration_ms` and the RSS in the `[Memory]` log lines (expect under 50 MB above the usual level).
5. At the close, read the day's counts by setup and grade, and spot-check 10 candidates against a chart: trigger time,
   range, VWAP, stop level. Tune the noisy thresholds (`level_hold`, `vwap_*`) before Anitir reads the list.
6. Only then point Anitir at `/api/anima/triggers`.

## What Anitir needs to consume it

- **Calls:** poll `GET /api/anima/triggers?since=<last next_cursor>&grade=A,B` every 1-2 minutes in the session. On
  `has_more`, ask again at once. Keep `next_cursor` per day (ids only grow; a new day starts at its first id).
- **Use:** rank by grade, then `risk_pct` (lowest first). Show `stop.level` and `stop.price` with `risk_pct` and
  `risk_adr` first. Check `data_as_of.bars` is fresh (under 15 minutes) before recommending. Pass `setup_key` and
  `setup_owner` into the `ideas` row so the record is measured per setup.
- **Health:** check `GET /api/anima/triggers/status` before trusting an empty list: `running` false or a `why` means
  no list, not "no trades".
