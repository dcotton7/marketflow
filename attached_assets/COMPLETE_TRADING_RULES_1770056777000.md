# SENTINEL TRADING RULES - COMPLETE BULLET LIST
**Version 1.0 - Comprehensive Rule Set**

---

## CORE PHILOSOPHY
- **"Judgment before risk"** - Only take A+ setups that meet all core criteria
- Pattern quality over quantity
- Risk management is paramount
- Patience for high-probability setups
- Don't chase extended stocks
- A rejected trade is better than a losing one

---

## AUTO-REJECT RULES (Instant 0 Score - Do Not Trade)
- ❌ Price below 50 SMA during base formation
- ❌ 50 SMA falling (counter-trend)
- ❌ Stop loss >5% from entry
- ❌ Extension ≥8% from 50 SMA (at/past profit-taking zone)
- ❌ Risk/Reward ratio <2:1
- ❌ No invalidation/stop can be defined
- ❌ Entry is extreme chase: >2.0 ATR above AVWAP (swing) or >1.5 ATR intraday
- ❌ Symbol data missing / incomplete snapshot
- ❌ Trade conflicts with market regime (Headwind) AND lacks defined edge justification

---

## THE 8% PROFIT-TAKING RULE (CRITICAL)
- ✅ Take profits at 8% extension from 50 SMA
- ❌ Never buy stocks at 7.5%+ extension from 50 SMA
- 🚨 Getting above 5% extension starts to add more risk
- 📐 Formula: `Target = 50 SMA × 1.08`
- 📐 Room to target: `((50 SMA × 1.08) - Entry) / Entry × 100`

---

## RISK/REWARD REQUIREMENTS
- ✅ Minimum acceptable: 4:1 ratio
- ✅ Target range: 6:1 to 8:1
- ✅ Excellent: 8:1 or better
- ❌ Below 2:1: Auto-reject
- 📐 Formula: `(Target - Entry) / (Entry - Stop)`

---

## STOP LOSS RULES

### Maximum Risk
- ❌ Never exceed 5% stop loss from entry (hard limit)

### Choppy Market Stops
- ✅ Initial stop: Low of day (LOD) following entry
- ✅ Trail stop: Move to prior day's low as price progresses
- ✅ If making 2-3% profit intraday, move stop to ensure NO loss
- ✅ In choppy market, sell 1/4 to 1/3 same day to ensure profit (could dive overnight)
- ✅ Can move to current day LOD to minimize risk

### Trending Market Stops
- ✅ Initial stop: Prior day low OR below MA (5/10/20/50d)
- ✅ Must use logical support level
- ✅ Prefer tighter stops when possible
- ✅ Move to 2-3 day swing lows (give more room)
- ✅ In trending market, can more safely hold overnight

### Universal Stop Rules
- ❌ NEVER move stop away from entry (only toward entry/profit)
- ✅ Lock in profits as soon as above breakeven
- ✅ OK to leave small piece to run as long as locked in profitability

---

## MA STRUCTURE REQUIREMENTS

### Mandatory Requirements
- ✅ Price MUST be above 50 SMA during entire base
- ✅ 50 SMA MUST be rising (not flat or falling)
- ✅ Price MUST be above 200 SMA at entry
- ✅ 50 SMA should be above 200 SMA (Stage 2 uptrend)
- ✅ Almost always want flat or rising MAs: 5, 10, 20, 50, 100

### MA Exceptions (Special Cases)
- ⚠️ MA bounce reversal trade
- ⚠️ Pullback (PB) bounce trade

### Extension from 50 SMA
- ✅ 0-3%: Ideal (room to run)
- ⚠️ 3-6%: Acceptable (some room)
- 🚨 6-7.5%: Caution (near resistance, more risk above 5%)
- ❌ 7.5-8%: Avoid (too close to sell zone)
- ❌ 8%+: Reject (at/past profit-taking zone)

### Extension from 200 SMA
- ✅ <20%: Ideal range
- ⚠️ 20-25%: Acceptable
- 🚨 25-40%: Elevated risk
- ❌ 40%+: Very risky (high pullback probability)

---

## BASE/PATTERN QUALITY RULES

### General Requirements (All Patterns)
- ✅ Price held above 50 SMA entire base (no breaks)
- ✅ Volume contracted during base formation (30%+ reduction ideal)
- ✅ Duration: 5-12 weeks ideal (2-12 weeks acceptable depending on pattern)
- ✅ Clean, orderly consolidation (not choppy)
- ✅ 50 SMA rising throughout

### Stage Preferences
- ✅ First base off lows: Best odds
- ⚠️ Second base: Acceptable but watch closely
- 🚨 Third base: Higher failure risk (-10 point penalty)
- ❌ Fourth+ base: Very risky (-15 point penalty)

### Cup & Handle Specifics
- ✅ Cup depth: 15-35% (25% ideal)
- ✅ Cup shape: U-shaped (NOT V-shaped)
- ✅ Handle depth: <15% of cup depth, <20% absolute
- ✅ Handle duration: 1-4 weeks
- ✅ Volume dries up in handle
- ❌ Handle breaks below 50% of cup depth = reject

### High Tight Flag (HTF) Specifics
- ✅ Prior gain: 40-120%+ in 4-8 weeks before base (40% minimum, 90-120% ideal)
- ✅ Consolidation: 8-20% range (tighter = better)
- ✅ Duration: 2-5 weeks (flexible)
- ✅ Volume contracts 40%+ during consolidation
- ❌ Consolidation >25% = reject

### VCP (Volatility Contraction Pattern) Specifics
- ✅ Multiple contraction stages (3+ pullbacks)
- ✅ Each pullback shallower than prior
- ✅ Ideal progression: 15-20% → 10-15% → 5-10%
- ✅ Volume progressively drying up
- ✅ Within 15% of 52-week high
- ❌ Below 200 SMA = reject

### Flat Base Specifics
- ✅ Range: 10-20% from high to low
- ✅ Duration: 2-12 weeks
- ✅ Orderly, not choppy
- ❌ Range >25% = not a flat base

---

## BREAKOUT QUALITY RULES

### Volume Requirements
- ✅ 150%+ above average: Excellent (institutional buying)
- ✅ 100-150% above average: Strong
- ⚠️ 50-100% above average: Acceptable
- 🚨 <50% above average: Weak
- ❌ Below base volume: Failed breakout

### Price Action Requirements
- ✅ Decisive move above resistance
- ✅ Clean breakout (no immediate pullback)
- ✅ Holds above breakout level
- ❌ Immediate reversal back into base = failed breakout

---

## POSITION SIZING RULES

### By Score
- 90-100 points: Full position (100%)
- 75-89 points: Full or slightly reduced (75-100%)
- 60-74 points: Reduced position (50-75%)
- <60 points: No position (0%)

### By Risk (Dollar-Based)
- ✅ Adjust size to keep dollar risk constant regardless of stop width
- Example: If risking $1,000 per trade:
  - 3% stop = $33,333 position size
  - 5% stop = $20,000 position size

---

## ENTRY TIMING RULES
- ✅ Enter at or near breakout
- ⚠️ Within 5% of pivot acceptable
- ❌ Chasing >5% past pivot = poor entry
- ✅ Use limit orders when possible
- ✅ Confirm volume on breakout before entering
- ❌ Entry >2.0 ATR above AVWAP (swing) = extreme chase, reject
- ❌ Entry >1.5 ATR above AVWAP (intraday) = extreme chase, reject

---

## PROFIT-TAKING RULES

### Scale Out Approach
- ✅ Take 1/3 off at 8% from 50 SMA (first resistance)
- ✅ Take 1/3 off at measured move target
- ✅ Trail final 1/3 with stop
- ✅ In choppy market: Take 1/4 to 1/3 same day if 2-3% profit to lock in gains

### Mandatory Exits
- ✅ Exit at 8% from 50 SMA or measured move (whichever comes first)
- ✅ Exit immediately if stop hit (no exceptions)
- ✅ Exit if pattern fails (breaks back into base)
- ✅ Exit if 50 SMA turns down
- ✅ Exit on major market sell-off

---

## DECISION MODELS

### Model A: Base Breakout (Primary Model)

**Intent:**
- Enter on breakout from consolidation with volume confirmation

**Required Conditions:**
- Clear base identified with duration and depth
- Price held above 50 SMA during base
- 50 SMA rising
- Breakout level defined
- Volume surge on breakout (>50% average minimum)
- Invalidation level defined (below base low)

**Strong Positives:**
- Volume 150%+ on breakout
- Clean price action (no whipsaws)
- First or second stage base
- Extension <5% from 50 SMA

**Entry Triggers:**
- Close (or intraday hold) above breakout level + volume confirmation
- Breakout + first pullback hold above breakout level (safer variant)

**Invalidation Patterns:**
- Rejection back into base and failure to reclaim within 3 bars (swing) or 10 bars (intraday)
- Break below base low (hard invalidation)
- Exception: "UnderCut and Rally" - breaking through low base and back up is acceptable

**Common Failure Modes:**
- False breakout with weak volume
- Breakout into resistance / supply overhang
- Market regime rollover

---

### Model B: Pullback / Reclaim (VWAP/AVWAP/MA)

**Intent:**
- Enter near support after pullback, on reclaim of key anchored level

**Required Conditions:**
- Clear anchor and level specified:
  - AVWAP anchor type: {swing_low, swing_high, breakout_day, earnings, gap_day}
  - AVWAP value must exist
- Pullback occurred to: AVWAP / 10D VWAP / 21SMA / 50SMA
- Reclaim confirmation: Price reclaims level and holds
- Risk defined: Invalidation below reclaim level or below pullback low

**Strong Positives:**
- Reclaim on increasing volume or "supporting volume" at VWAP
- Tight alignment of VWAPs (10D and 30D within 0.5-1.0%)
- RSI in strength zone (55-70)
- MACD "open" supports continuation
- Market regime Tailwind or sector Tailwind

**Disqualifiers:**
- Entry >1.25 ATR above AVWAP (too extended for reclaim setup)
- No reclaim: entering while still below key level without plan (catching falling knife)
- Invalidation not defined (no stop)
- Market regime Headwind + reclaim lacks exceptional strength

**Entry Triggers:**
- "Dip and reclaim": tags AVWAP/VWAP then reclaims and holds
- "Pullback to MA + reclaim": reclaims 21/50 with supporting volume

**Invalidation Patterns:**
- Close below reclaimed level for 1-2 bars (swing)
- Sustained hold below for X minutes (intraday)
- Break below pullback low (hard)

**Common Failure Modes:**
- "Reclaim fail" (wicks above but closes below)
- Regime/sector deterioration mid-trade

---

### Model C: Episodic Pivot / Catalyst (EP)

**Intent:**
- Exploit strong demand shift triggered by catalyst (earnings, guidance, major news, regulatory)

**Required Conditions:**
- Catalyst identified: earnings/guidance OR major news with clear narrative
- Demand shock evidence:
  - Gap up OR large range day + volume spike (≥2x 20-day avg)
  - Or multi-day surge with sustained volume (≥1.5x)
- Levels + risk defined:
  - Pivot level: high of catalyst day, gap level, or consolidation high
  - Invalidation: under key pivot or under gap support
- Not pure chase: Entry must be planned (pivot break or first pullback hold)

**Strong Positives:**
- Price holds above AVWAP anchored to catalyst day
- Sector tailwind / market tailwind
- Relative strength vs index

**Disqualifiers:**
- No catalyst clarity ("I heard something")
- Entry after multi-ATR extension without consolidation (>2 ATR above catalyst AVWAP)
- No clean pivot level / no invalidation
- Weak volume after initial day (no follow-through)

**Entry Triggers:**
- Pivot break above catalyst high
- First pullback to gap support + reclaim
- Tight consolidation after catalyst + breakout

**Invalidation Patterns:**
- Failure to hold gap support / catalyst AVWAP
- Reversal below pivot and no reclaim within M bars

**Common Failure Modes:**
- "One-day wonder" (volume fades)
- Market risk-off overwhelms catalyst

---

### Model D: Mean Reversion (Oversold Bounce)
- ⚠️ NOT ENABLED in v1 by default
- High risk of training "bad habits"
- High regime sensitivity
- Reserved for v2

---

## MINIMUM STANDARDS FOR ANY TRADE

### Minimum Score to Trade
- ❌ <50 points: Reject (don't trade)
- ⚠️ 50-59 points: Watch only (no entry)
- ⚠️ 60-69 points: Marginal (very small position if at all)
- ✅ 70-79 points: Acceptable (reduced position)
- ✅ 80-89 points: Good (normal position)
- ✅ 90-100 points: Excellent (full position)

---

## MARKET REGIME ADJUSTMENTS

### Bull Market (Trending)
- ✅ Can tolerate 25-30% extension from 200 SMA
- ✅ Use 4-5% stops acceptable
- ✅ Target larger gains (measured moves)
- ✅ Hold for full measured move potential

### Choppy Market
- ✅ Demand <20% extension from 200 SMA
- ✅ Use tight stops (LOD following entry, or current day LOD)
- ✅ Take quick profits (3-5%)
- ✅ Trail aggressively
- ✅ Sell 1/4 to 1/3 same day if 2-3% profit to lock gains

### Bear Market (Headwind)
- ❌ Avoid all trades scoring <85
- ✅ Only strongest relative strength trades
- ✅ Tighten all stops by 1%
- ✅ Take profits at 8% without exception
- ❌ Reject trades that conflict with regime unless exceptional edge defined

---

## EVIDENCE REQUIREMENTS (What Data Must Be Present)

### For Base Breakout (Model A)
- Historical price data showing base formation
- Volume data for base period and breakout
- 50 SMA and 200 SMA values
- Clear breakout level identified
- Base low for invalidation

### For Pullback/Reclaim (Model B)
- AVWAP anchor type and date specified
- AVWAP value calculated
- Pullback low identified
- Reclaim level defined
- Volume at reclaim point

### For Catalyst Trade (Model C)
- Catalyst identified with date and description
- Volume data showing demand shock
- Catalyst AVWAP calculated
- Gap level or pivot high defined
- Relative strength vs index/sector

---

## PROHIBITED ACTIONS (Never Do These)
- ❌ Never trade stocks below 50 SMA (except MA bounce reversals)
- ❌ Never buy at 7.5%+ from 50 SMA
- ❌ Never use stops wider than 5%
- ❌ Never take trades with <2:1 risk/reward (prefer 4:1 minimum)
- ❌ Never move stops away from entry
- ❌ Never hope a losing trade comes back
- ❌ Never trade counter-trend (50 SMA falling)
- ❌ Never chase breakouts >5% past pivot
- ❌ Never chase >2 ATR above AVWAP (swing) or >1.5 ATR (intraday)
- ❌ Never trade third/fourth bases aggressively
- ❌ Never ignore auto-reject criteria
- ❌ Never trade without defined invalidation level
- ❌ Never enter "catching falling knife" (below key level without reclaim plan)
- ❌ Never trade on rumor ("I heard something")

---

## REQUIRED ACTIONS (Always Do These)
- ✅ Always calculate extension from 50 SMA before entry
- ✅ Always calculate extension from 200 SMA before entry
- ✅ Always verify price held above 50 SMA during base
- ✅ Always confirm 50 SMA is rising (or justified exception)
- ✅ Always ensure risk/reward is at least 4:1 (minimum 2:1)
- ✅ Always use stops <5%
- ✅ Always honor stops (exit immediately when hit)
- ✅ Always take profits at 8% from 50 SMA
- ✅ Always trail stops as price progresses
- ✅ Always prefer first-stage bases over later stages
- ✅ Always define invalidation level before entry
- ✅ Always confirm volume on breakouts
- ✅ Always specify decision model (A, B, or C)
- ✅ Always identify catalyst for Model C trades
- ✅ Always define AVWAP anchor for Model B trades
- ✅ Always map trade to explicit decision model
- ✅ Always lock in profits in choppy markets (1/4 to 1/3 same day)

---

## GRADING CRITERIA

**Sentinel grades decision quality based on:**
- Pattern alignment with chosen decision model
- Risk clarity (stop defined, R/R acceptable)
- Extension metrics (from 50 SMA and 200 SMA)
- Evidence requirements met
- No disqualifiers present
- Market regime alignment

**Grade Output:**
- Red: Auto-reject (hard fail)
- Yellow: Marginal (reduce size or wait)
- Green: Acceptable to excellent (trade with confidence)

---

## GLOBAL HARD-FAILS (Apply to All Models)

**If ANY is true → Status must be Red (unless explicitly marked speculative):**
- No invalidation/stop can be defined
- Entry is extreme chase: >2.0 ATR above AVWAP (swing) or >1.5 ATR intraday
- Symbol data missing / incomplete snapshot
- Trade conflicts with market regime (Headwind) AND lacks defined edge justification
- Extension ≥8% from 50 SMA
- Stop loss >5% from entry
- Risk/Reward <2:1
- Price below 50 SMA during base (Model A)
- 50 SMA falling (unless justified exception)

---

## KEY FORMULAS

**Extension from 50 SMA:**
```
Extension% = ((Entry - 50 SMA) / 50 SMA) × 100
```

**Room to 8% Target:**
```
Room% = (((50 SMA × 1.08) - Entry) / Entry) × 100
```

**Extension from 200 SMA:**
```
Extension% = ((Entry - 200 SMA) / 200 SMA) × 100
```

**Risk/Reward Ratio:**
```
R/R = (Target - Entry) / (Entry - Stop)
```

**Stop Loss Percentage:**
```
Stop% = ((Entry - Stop) / Entry) × 100
```

**Position Size (Dollar Risk Based):**
```
Position Size = Fixed Dollar Risk / (Entry - Stop)
```

**ATR Extension:**
```
ATR Extension = (Entry - Reference Point) / ATR
```

---

## SPECIAL NOTES

### UnderCut and Rally Exception
- Breaking through a low base and rallying back up is acceptable
- Not considered a failed pattern invalidation
- Watch for volume on the rally back

### Choppy vs Trending Markets
- Choppy: Aggressive same-day profit-taking to lock gains
- Trending: Can hold overnight and through small pullbacks
- Adjust trailing stops based on regime

### ATR (Average True Range) Usage
- Used to measure extension from AVWAP
- Helps identify "extreme chase" scenarios
- >2 ATR extension (swing) or >1.5 ATR (intraday) = too extended

### VWAP vs AVWAP
- VWAP: Standard volume-weighted average price (10D, 30D typical)
- AVWAP: Anchored VWAP from specific event (earnings, gap, pivot)
- Both used as dynamic support/resistance in Model B

---

**Core Philosophy Reminder:**
*"Judgment before risk"* - Map every trade to a decision model, define risk clearly, respect the rules, and only take setups that align with proven patterns.
