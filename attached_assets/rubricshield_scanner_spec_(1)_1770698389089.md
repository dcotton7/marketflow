# RUBRICSHIELD Scanner Specification
## Thought & Idea Builder System

---

## 1. SYSTEM OVERVIEW

The Scanner is a visual logic-flow builder for stock screening criteria. It has two core building blocks:

### What is a Thought?
A Thought is the smallest reusable filter block. It contains one or more criteria connected by AND logic. A Thought takes in a universe of stocks and outputs only those that pass all its internal criteria.

Example Thought — "Weekly Base":
- Stock has been consolidating for at least 2 weeks (AND)
- The price range during consolidation is less than 15% from high to low (AND)
- Volume has been declining during the consolidation

All three must be true for a stock to pass this Thought.

### What is an Idea?
An Idea is a strategy built by connecting multiple Thoughts together on a visual canvas. Thoughts are dragged onto the canvas as boxes. The user draws wires between them to create logic flows. Connections can be AND (both must pass), OR (either can pass), or NOT (must fail to qualify).

The key design principle: Thoughts are connected in sequence using AND to narrow the universe, they can branch using OR to widen what qualifies at a decision point, and NOT connections act as exclusion filters that reject stocks matching unwanted conditions.

### How Thoughts and Ideas Work Together

```
STOCK UNIVERSE
      |
  [Thought A] ---- AND filter, narrows the list
      |
  [Thought B] ---- AND filter, narrows further
      |
   /     \
  OR      OR  ---- Branch point, widens what qualifies
  |        |
[Thought C] [Thought D]
  |        |
   \     /
    |
  [NOT Thought E] ---- Exclusion filter, rejects stocks that match
    |
  RESULTS ---- Stocks that passed A AND B AND (C OR D) AND NOT E
```

### Output Type
Thoughts output boolean — pass or fail. The Scanner's job is to FIND stocks. The Rubric's job is to SCORE them. The Scanner surfaces candidates, then the Rubric evaluates quality.

Future enhancement: Thoughts could optionally output a quality score (0-100) for ranking results when the scanner returns many matches. This is a version 2 feature.

---

## 2. THOUGHT ANATOMY

Every Thought has the following structure:

### Thought Properties
- **Name**: User-defined label (example: "Pullback to Key MA")
- **Category**: Which group it belongs to (Price Action, Volume, Trend, Fundamentals)
- **Parameters**: Adjustable settings with defaults (example: which MA, how close)
- **Criteria**: One or more conditions connected by AND
- **Input**: Receives a list of stocks
- **Output**: Returns only stocks that pass all criteria (boolean pass/fail)

### Parameter Design
Every number or choice inside a Thought should be a parameter the user can adjust. The AI's job is to suggest sensible defaults so the user doesn't have to configure everything from scratch.

Example — Thought "Near a Moving Average":
- Parameter: MA Type (choices: SMA, EMA) — default: SMA
- Parameter: MA Period (number) — default: 50
- Parameter: Proximity (percentage above or below) — default: 3%
- Parameter: Direction (choices: from above, from below, either) — default: either

The user describes what they want in plain English. The AI picks the right indicators, sets the parameters, and shows the user a plain-English summary. The user can then tweak with sliders and dropdowns.

---

## 3. IDEA BUILDER — VISUAL CANVAS

### Canvas Elements
- **Thought Boxes**: Draggable rectangles showing the Thought name, category icon, and a brief summary of its criteria
- **Connectors**: Wires drawn between output port of one Thought and input port of another
- **Logic Nodes**: Small circles on the canvas labeled AND or OR that define how connections merge
- **Results Node**: A final box where qualifying stocks collect

### Connection Rules
1. A Thought's output can connect to one or more downstream Thoughts
2. When one output connects to multiple Thoughts, those connections are OR by default (the stock can take either path)
3. When multiple outputs connect to one Thought's input, those connections are AND by default (the stock must have passed all upstream Thoughts)
4. The user can toggle any connection point between AND, OR, and NOT
5. Every path must eventually lead to the Results node

### NOT Operator
NOT works at two levels:

**Within a Thought — Criterion Inversion**: Any individual criterion inside a Thought can be inverted. Example: "Volume is NOT above 2x average" filters out climax volume days. The criterion toggle flips the pass/fail logic for that one condition.

**Within an Idea — Thought Inversion**: Any Thought box on the canvas can be toggled to NOT mode. When a Thought is set to NOT, stocks must FAIL that Thought to continue down the flow. This creates exclusion filters.

Common exclusion Thoughts:
- "Climax Top" — if the stock matches this pattern, it's rejected
- "Extended Beyond Buy Zone" — NOT this, only want stocks still in the buy zone
- "Earnings Too Close" — NOT this, avoid earnings risk
- "Low Float Junk" — NOT this, filter out illiquid names

Visually, NOT Thoughts are displayed with a distinct color or border (e.g., red border) so the user can immediately see which Thoughts are filters vs exclusions.

### Path Tagging
When a stock reaches Results, the system records WHICH path it took. If a stock qualifies through multiple paths, it shows up once but is tagged with all qualifying paths. This tells the user which signals are firing.

Example result display:
- AAPL — passed via: "Early Breakout" path
- MSFT — passed via: "Retest & Resume" path
- NVDA — passed via: BOTH paths (stronger signal)

---

## 4. INDICATOR LIBRARY — STARTER SET

These are the hardcoded indicators available for building Thoughts. The calculations are fixed and reliable. The AI uses these as building blocks when helping users create Thoughts.

---

### CATEGORY 1: MOVING AVERAGES AND TREND

**MA-1: Simple Moving Average (SMA)**
What it does: Calculates the average closing price over a set number of days.
Common periods: 10, 20, 21, 50, 100, 150, 200
How it's used in Thoughts: Price position relative to it, slope direction, crossovers

**MA-2: Exponential Moving Average (EMA)**
What it does: Same as SMA but gives more weight to recent prices, so it reacts faster.
Common periods: 8, 10, 12, 21, 26, 50
How it's used in Thoughts: Faster signals for short-term setups, MACD calculations

**MA-3: Price Position Relative to MA**
What it does: Measures how far the current price is above or below a given MA, expressed as a percentage.
Example: Stock is 2.5% above its 50-day SMA
Parameters: Which MA, acceptable range (percentage above/below)
Use case: "Stock is within 3% of the 200-day MA"

**MA-4: MA Slope**
What it does: Measures whether a moving average is rising, flat, or falling over a set number of periods. Expressed as percentage change of the MA value over N days.
Parameters: Which MA, lookback period (default 10 days), slope threshold
Example: 50-day SMA slope over last 10 days is +0.3% (gently rising)
Use case: "The 50-day MA must be flat or rising" means slope is greater than -0.5%

**MA-5: MA Stacking Order**
What it does: Checks the relative position of multiple moving averages to confirm trend alignment.
Example: Price > 50 SMA > 150 SMA > 200 SMA (bullish stacking, Mark Minervini trend template)
Parameters: Which MAs to check, required order
Use case: "Stock must have proper MA stacking for confirmed uptrend"

**MA-6: MA Distance / Convergence**
What it does: Measures the percentage distance between two moving averages.
Example: The 50-day SMA is 5% above the 200-day SMA
Parameters: Which two MAs, minimum/maximum distance
Use case: "50 and 200 day MAs are converging" (distance is decreasing)

**MA-7: MA Crossover Detection**
What it does: Detects when a faster MA crosses above or below a slower MA.
Parameters: Fast MA, Slow MA, direction (bullish cross = fast above slow), recency (within last N days)
Use case: "The 10-day EMA crossed above the 21-day EMA in the last 5 trading days"

---

### CATEGORY 2: VOLUME

**VOL-1: Volume vs Average**
What it does: Compares today's volume (or recent volume) to the 50-day average volume, expressed as a multiple.
Example: Today's volume is 2.3x the 50-day average
Parameters: Comparison period (today, last 3 days, last 5 days), average period (default 50), minimum multiple
Use case: "Volume is at least 1.5 times the 50-day average"

**VOL-2: Volume Trend**
What it does: Measures whether average daily volume is increasing or decreasing over a period. Compares recent average volume (last N days) to longer-term average volume.
Parameters: Recent period (default 10 days), baseline period (default 50 days), direction (rising/falling)
Use case: "Volume has been declining over the last 3 weeks" (base building, volume dry-up)

**VOL-3: Up Volume vs Down Volume Ratio**
What it does: Over a lookback period, adds up all volume on up days and all volume on down days, then computes the ratio.
Parameters: Lookback period (default 50 days), minimum ratio
Example: Up/Down volume ratio of 1.8 over last 50 days means 80% more volume on up days
Use case: "Accumulation is happening — up volume ratio above 1.5"

**VOL-4: Volume Dry-Up**
What it does: Specifically detects when volume contracts significantly during a consolidation or base. Measures the lowest volume readings relative to average.
Parameters: Window to check (default: last 10 days), percentage of average volume that qualifies as dry-up (default: below 60% of 50-day average)
Use case: "Volume has dried up during the base — at least 3 days below 60% of average in the last 2 weeks"

**VOL-5: Volume Surge Detection**
What it does: Identifies days where volume spiked significantly above average. Returns the count and magnitude of surges in a lookback period.
Parameters: Surge threshold (default: 2x average), lookback period, minimum number of surge days
Use case: "At least one day in the last week with volume over 2x the 50-day average"

---

### CATEGORY 3: PRICE ACTION AND STRUCTURE

**PA-1: ATR (Average True Range)**
What it does: Measures the average daily price range (including gaps) over N days. Represents typical daily volatility in dollar terms.
Parameters: Period (default 14 days)
How it's used: As a building block for other criteria — stop distances, breakout thresholds, position sizing. Also useful for comparing volatility between stocks when expressed as a percentage of price (ATR%).

**PA-2: ATR Percent**
What it does: ATR divided by current price, expressed as percentage. Normalizes volatility across different price levels.
Parameters: ATR period (default 14), maximum/minimum ATR%
Use case: "Stock has daily volatility under 3%" filters out highly volatile names

**PA-3: Consolidation / Base Detection**
What it does: Measures how tight the price range has been over a period. Calculates the percentage from the highest high to the lowest low within a window.
Parameters: Minimum duration (weeks), maximum range (percentage from high to low), volume behavior during base
Example: Stock has been in a range of 12% for the last 6 weeks
Use case: "Stock has been consolidating for at least 3 weeks with a range under 15%"

**PA-4: Base Depth**
What it does: Measures how far the stock has pulled back from its most recent high before the consolidation began. Expressed as percentage decline from peak to trough of the base.
Parameters: Maximum acceptable depth (default 35%), minimum depth (default 10%)
Use case: "Base correction is between 15% and 30% — healthy pullback, not broken"

**PA-5: Base Count**
What it does: Counts how many distinct consolidation bases the stock has formed in its current advance. First and second bases are statistically more reliable than third or later bases.
Parameters: Maximum base count (default: 3)
Use case: "Stock is building its first or second base — early in the move"

**PA-6: Distance from 52-Week High**
What it does: Percentage the current price is below the 52-week high.
Parameters: Maximum distance (percentage)
Example: Stock is 8% below its 52-week high
Use case: "Stock is within 15% of its 52-week high — showing relative strength"

**PA-7: Breakout Detection**
What it does: Identifies when price moves above a resistance level (base high, pivot point, or prior high). Measures how far into the breakout the stock is.
Parameters: Reference level (base high, N-week high, custom), how far into breakout (percentage above level), recency (breakout happened within last N days)
Use case: "Stock broke out above its 8-week base high within the last 3 days and is less than 3% extended"

**PA-8: Pullback to Level**
What it does: Detects when price has pulled back to within a specified distance of a support level after a move up.
Parameters: Reference level (specific MA, prior breakout level, prior base high), proximity (percentage), direction (approaching from above)
Use case: "Stock has pulled back to within 1% of its 21-day EMA"

**PA-9: Tightness (VCP Pattern Detection)**
What it does: Measures whether successive contractions within a base are getting tighter — each swing high to low is a smaller percentage than the previous one. This is the core of the Volatility Contraction Pattern.
Parameters: Minimum number of contractions (default 2), contraction ratio (each must be at least X% smaller than previous)
Use case: "Base shows at least 3 contractions where each is at least 40% smaller than the previous"

**PA-10: Price Gap Detection**
What it does: Identifies gap ups or gap downs — when a stock opens significantly above or below the prior day's close.
Parameters: Minimum gap size (percentage), direction (up/down/either), recency (within last N days), volume requirement during gap
Use case: "Stock gapped up more than 3% on above-average volume in the last 5 days"

**PA-11: Distance from Key Level (VWAP, Pivot, etc.)**
What it does: Measures how far the current price is from an anchored VWAP, a classic pivot point, or a user-defined price level.
Parameters: Reference level type, proximity (percentage above or below)
Use case: "Price is within 2% of the anchored VWAP from the last earnings date"

---

### CATEGORY 4: RELATIVE STRENGTH AND MOMENTUM

**RS-1: Relative Strength vs Index**
What it does: Compares the stock's price performance over a period to a benchmark index (SPY, QQQ, IWM). Expressed as outperformance or underperformance in percentage points.
Parameters: Benchmark (default SPY), timeframes to check (1 month, 3 months, 6 months, 12 months), minimum outperformance
Use case: "Stock has outperformed SPY by at least 10 percentage points over the last 3 months"

**RS-2: RS Ranking Percentile**
What it does: Ranks the stock's relative performance against all other stocks in the universe. Expressed as a percentile (99 = top 1%).
Parameters: Timeframe (default: composite of multiple), minimum percentile (default: 80)
Use case: "Stock is in the top 15% of all stocks by relative strength"

**RS-3: RS Line New High**
What it does: Checks whether the relative strength line (stock price divided by index price) is making new highs. RS line making new highs before price does is a bullish signal.
Parameters: Benchmark index, RS line at new high (yes/no), RS line at new high before price (yes/no), lookback period
Use case: "RS line is making a new 52-week high while price is still below its 52-week high"

**RS-4: RSI (Relative Strength Index)**
What it does: Momentum oscillator measuring speed and magnitude of recent price changes. Ranges from 0 to 100. Above 70 is traditionally overbought, below 30 is oversold.
Parameters: Period (default 14), overbought threshold, oversold threshold, specific range
Note: Best used as a secondary filter, not a primary signal for momentum/breakout trading.
Use case: "RSI is between 50 and 70 — showing momentum but not overextended"

**RS-5: MACD**
What it does: Moving Average Convergence Divergence. The MACD line is the difference between the 12-period EMA and 26-period EMA. The signal line is the 9-period EMA of the MACD line. The histogram is the difference between the two.
Parameters: Fast period (default 12), slow period (default 26), signal period (default 9), condition to check (bullish crossover, histogram rising, MACD above zero)
Use case: "MACD has crossed above the signal line within the last 3 days"

**RS-6: ADX (Average Directional Index)**
What it does: Measures trend strength regardless of direction. Above 25 generally indicates a strong trend. Includes +DI and -DI components for direction.
Parameters: Period (default 14), minimum ADX value (default 25), directional requirement (+DI > -DI for uptrend)
Use case: "ADX above 25 with +DI above -DI — stock is in a strong uptrend"

**RS-7: Bull/Bear Power (Elder)**
What it does: Bull Power = day's high minus the 13-period EMA. Bear Power = day's low minus the 13-period EMA. Measures buying pressure vs selling pressure.
Parameters: EMA period (default 13), condition (Bull Power > 0 and rising, Bear Power approaching zero from below)
Use case: "Bull Power is positive and increasing — buyers are in control"

---

### CATEGORY 5: VOLATILITY

**VLT-1: Bollinger Band Width**
What it does: Measures the distance between upper and lower Bollinger Bands as a percentage of the middle band. Low width = squeeze (low volatility), high width = expansion.
Parameters: Period (default 20), standard deviations (default 2), width threshold
Use case: "Bollinger Band width is in the bottom 20% of its 6-month range — squeeze is building"

**VLT-2: ATR Contraction/Expansion**
What it does: Compares recent ATR to longer-term ATR to detect whether volatility is contracting (potential breakout setup) or expanding (move underway).
Parameters: Recent ATR period (default 5 days), baseline ATR period (default 20 days), contraction threshold
Use case: "Current ATR is less than 70% of the 20-day average ATR — volatility is contracting"

**VLT-3: Daily Range vs Average Range**
What it does: Compares today's price range (high minus low) to the average daily range over N days.
Parameters: Average period (default 20 days), comparison (above/below), multiple
Use case: "Today's range is more than 1.5x the average daily range — significant price action"

**VLT-4: Squeeze Detection (Composite)**
What it does: Combines Bollinger Band width contraction with Keltner Channel containment. When Bollinger Bands move inside Keltner Channels, it signals a volatility squeeze that often precedes a big move.
Parameters: BB period (default 20), BB std dev (default 2), Keltner period (default 20), Keltner ATR multiple (default 1.5)
Use case: "Bollinger Bands are inside Keltner Channels — squeeze is active"

---

### CATEGORY 6: FUNDAMENTALS

**FUN-1: EPS Growth — Current Quarter**
What it does: Year-over-year earnings per share growth for the most recent reported quarter. Expressed as a percentage.
Parameters: Minimum growth (default 20%), compare to prior quarter's growth (accelerating check)
Use case: "Current quarter EPS growth is at least 25% year-over-year"

**FUN-2: EPS Growth — Annual**
What it does: Year-over-year annual earnings per share growth. Looks at trailing twelve months or last fiscal year.
Parameters: Minimum growth (default 20%)
Use case: "Annual EPS growth is at least 20%"

**FUN-3: EPS Acceleration**
What it does: Checks whether the rate of EPS growth is increasing from quarter to quarter. Growth of 15%, then 20%, then 30% shows acceleration.
Parameters: Number of quarters to check (default 3), required direction (each quarter higher than previous)
Use case: "EPS growth has accelerated over the last 3 quarters"

**FUN-4: Revenue/Sales Growth**
What it does: Year-over-year revenue growth for the most recent quarter or annual period.
Parameters: Minimum growth (default 20%), period (quarterly/annual)
Use case: "Quarterly revenue growth is at least 25%"

**FUN-5: Sales Acceleration**
What it does: Same concept as EPS acceleration but for revenue. Checks if revenue growth rate is increasing.
Parameters: Number of quarters (default 3), required direction
Use case: "Revenue growth has accelerated for at least 2 consecutive quarters"

**FUN-6: Profit Margins**
What it does: Checks gross margin, operating margin, or net margin levels and their trend.
Parameters: Which margin type, minimum value, trend direction over N quarters (expanding/stable/contracting)
Use case: "Net margin is above 15% and has been stable or expanding over 4 quarters"

**FUN-7: Return on Equity (ROE)**
What it does: Net income divided by shareholder equity. Measures how efficiently the company uses equity to generate profits.
Parameters: Minimum ROE (default 15%)
Use case: "ROE is above 17%"

**FUN-8: Institutional Ownership**
What it does: Percentage of shares held by institutional investors (mutual funds, hedge funds, pension funds) and recent changes.
Parameters: Minimum ownership percentage, direction of change (increasing/decreasing over last quarter)
Use case: "Institutional ownership is above 40% and increased last quarter — smart money is accumulating"

**FUN-9: Float Size**
What it does: The number of shares available for public trading. Smaller floats can lead to more explosive moves.
Parameters: Maximum float (shares), minimum float
Use case: "Float is under 100 million shares"

**FUN-10: Industry/Sector Group Rank**
What it does: Ranks the stock's industry group by collective performance relative to all other industry groups. Stronger groups tend to produce more winning stocks.
Parameters: Minimum rank (top N percent), timeframe for ranking
Use case: "Stock's industry group is in the top 30% of all groups by 6-month performance"

**FUN-11: Earnings Date Proximity**
What it does: Checks how many days until the next earnings report or how recently earnings were reported.
Parameters: Days until next earnings (minimum/maximum), days since last earnings
Use case: "Earnings were reported within the last 10 days" (for post-earnings breakout setups) or "Next earnings is more than 20 days away" (to avoid earnings risk)

**FUN-12: Analyst Estimate Revisions**
What it does: Tracks whether analysts are raising or lowering their EPS estimates for upcoming quarters. Rising estimates are a bullish fundamental signal.
Parameters: Direction (up/down), magnitude (minimum percentage revision), timeframe (last 30/60/90 days)
Use case: "EPS estimates for next quarter have been revised upward by at least 5% in the last 60 days"

---

## 5. AI-ASSISTED THOUGHT CREATION

This is how the AI helps users build Thoughts without getting lost in configuration.

### The Workflow

Step 1: User describes what they want in plain English.
Example: "I want to find stocks that are pulling back to a moving average on quiet volume"

Step 2: AI selects indicators from the library above.
Selected: MA-3 (Price Position Relative to MA), VOL-1 (Volume vs Average), VOL-4 (Volume Dry-Up)

Step 3: AI proposes parameters with sensible defaults.
Proposed Thought — "Pullback to MA on Light Volume":
- Price is within 3% of the 50-day SMA (approaching from above)
- Current volume is below 80% of the 50-day average volume
- At least 2 days in the last 5 with volume below 60% of average

Step 4: AI shows the user a plain-English summary.
"This Thought will find stocks whose price has pulled back to within 3% of their 50-day moving average, and volume during the pullback is below average — suggesting selling pressure is drying up."

Step 5: User can accept or tweak.
Each parameter appears as a slider or dropdown:
- MA Type: [SMA ▼] Period: [50 ←→]
- Proximity: [3% ←→]
- Volume threshold: [80% ←→]
- Dry-up days: [2 ←→] out of last [5 ←→] days below [60% ←→]

### What the AI Decides
- Which indicators to combine (no hard cap — use as many as needed, but if a Thought is getting past 5-6 criteria, the AI should suggest splitting into multiple Thoughts wired together in an Idea)
- What parameter values make sense for the described scenario
- How to phrase the summary in plain English
- What the Thought should be named and categorized as
- Creative composite conditions that combine multiple indicators in novel ways (e.g., "ATR contraction rate relative to RS line slope" — not a standalone indicator, but a meaningful combination of existing ones)

### What the AI Does NOT Decide
- The actual math behind each indicator (hardcoded, tested, reliable)
- Whether to invent entirely new indicator formulas — the AI works from the library but can combine indicators creatively

The value of the AI is not inventing new math. Every useful technical indicator has been discovered and battle-tested by decades of real trading. The AI's creative value comes from combining existing indicators in ways the user might not think to try, and setting parameters intelligently so the user doesn't have to guess.

### AI Prompt Template (for Replit Implementation)
When the user describes a Thought, send this to the AI:

```
You are helping a trader build a screening filter called a "Thought."

The user said: "[user's plain English description]"

Available indicators: [list from the indicator library with their IDs and descriptions]

Your job:
1. Select the indicators that together capture what the user described. Use as many as needed but keep it focused — if you need more than 5-6, suggest splitting into multiple Thoughts.
2. Set parameter values that make sense for this scenario
3. Write a plain-English summary of what the Thought does
4. Suggest a name and category for the Thought
5. If any criterion should be inverted (NOT logic), specify that clearly

Respond in this format:
- Thought Name: [name]
- Category: [Price Action / Volume / Trend / Fundamentals / Composite]
- Indicators Used: [list of indicator IDs]
- Parameters: [for each indicator, the specific settings]
- Inverted Criteria: [any criteria using NOT logic, or "None"]
- Plain English Summary: [1-2 sentences]
- Criteria Logic: [how the indicators combine — all are AND within a Thought unless noted]
- Splitting Suggestion: [if the Thought is complex, suggest how to split into multiple Thoughts and wire them]
```

---

## 6. EXAMPLE IDEAS (Fully Wired)

### Example 1: Base Breakout with Volume

```
[Thought A: "Healthy Base"]                [Thought D: "Uptrend Confirmed"]
  PA-3: Base of at least 3 weeks             MA-5: Price > 50 > 150 > 200
  PA-4: Base depth between 10-30%            MA-4: 200 MA slope is flat or rising
  VOL-4: Volume dry-up during base
      |                                           |
      AND ─────────────────────────────────── AND
                        |
              [Thought B: "Breakout"]
                PA-7: Price above base high
                PA-7: Less than 5% above breakout
                VOL-5: Volume surge day (>1.5x avg)
                        |
                      RESULTS
```

### Example 2: Dip and Reclaim (from our earlier conversation)

```
[Thought A: "Weekly Base"]
  PA-3: Consolidation ≥ 2 weeks
        |
        AND
        |
[Thought B: "Dip & Reclaim Key Level"]
  PA-8: Price dipped below level (VWAP or MA)
  PA-11: Price reclaimed back above level
        |
     /     \
    OR      OR
    |        |
[Thought C]  [Thought D]
"Early        "Retest &
Breakout"     Resume"
  PA-7          PA-8: Within 1%
  < 3%          of prior base
  above         PA-3: Basing
  level         again or
                moving up
    |            |
     \          /
      RESULTS
```

### Example 3: 200 MA Recovery (from our earlier conversation)

```
[Thought A: "Near 200 MA Zone"]
  MA-3: Price within 5% above or below 200 SMA
        |
        AND
        |
[Thought B: "Strong Volume Approach"]
  VOL-1: Volume > 1.5x 50-day average
  Direction: Price moving up toward or above 200 MA
        |
        AND
        |
[Thought C: "50 MA Slope Filter"]
  MA-4: 50 SMA slope is > -0.5% over 10 days
  (flat, rising, or only slightly declining)
        |
      RESULTS
```

---

## 7. DATA SOURCE AND STOCK UNIVERSE

### Data Source
Development: Yahoo Finance (free). Use yfinance (Python) or yahoo-finance2 (Node.js) libraries to handle data retrieval. Yahoo provides adequate OHLCV and basic fundamental data for building and testing the system.

Production: Swap to a paid provider for reliability and speed. Recommended options:
- Polygon.io for technicals (price, volume, intraday)
- Financial Modeling Prep for fundamentals (EPS, revenue, margins, institutional data)

Yahoo's free data has known limitations: fundamentals can be spotty, no official API so endpoints can break, and rate limits apply. Acceptable for development and proof of concept, not for a production SaaS with paying customers.

### Starting Stock Universe
Development: S&P 500 (500 stocks). Enough to test all indicator calculations and scan performance without overloading the system.

### Production Universe Tiers (aligned with SaaS pricing)
- $19 plan: S&P 500 (500 stocks)
- $49 plan: S&P 500 + Nasdaq 100 + Russell 1000 (~1,000 unique stocks)
- $99 plan: Full universe — Russell 3000 or all US stocks above a minimum liquidity threshold (e.g., average volume > 100,000 shares/day AND price > $5)

The universe filter for the $99 tier prevents scanning penny stocks and illiquid names that would generate noise.

---

## 8. DATA REQUIREMENTS

### For Technical Indicators
- Daily OHLCV (Open, High, Low, Close, Volume) data going back at least 1 year, ideally 2 years
- Adjusted for splits and dividends
- Data source needs: End-of-day minimum, intraday (15-min or less) for VWAP and intraday setups

### For Fundamental Indicators
- Quarterly earnings reports (EPS, revenue) going back at least 8 quarters
- Annual financial data (margins, ROE) going back at least 3 years
- Institutional ownership data (quarterly 13F filings)
- Float and shares outstanding data
- Industry/sector classification and group performance data
- Earnings calendar (upcoming report dates)
- Analyst estimate data (consensus estimates and revisions)

### Data Update Frequency
- Price and volume: End of day minimum, real-time or 15-minute delay preferred
- Fundamentals: After each earnings season (quarterly)
- Institutional ownership: Quarterly (45 days after quarter end when 13Fs are filed)
- Analyst estimates: Weekly
- Industry group rankings: Weekly

---

## 9. LIVE RESULT COUNTER — REAL-TIME FEEDBACK UX

The live counter is a core UX feature that gives the user immediate feedback as they build an Idea on the canvas. It answers the question: "How many stocks does this Idea currently match?"

### How It Works

A floating counter is always visible on the canvas (top-right corner or bottom bar). It shows the total number of stocks currently passing the entire Idea.

As the user builds:
1. User drags first Thought onto canvas → counter updates: "412 stocks match"
2. User adds second Thought with AND connection → counter updates: "83 stocks match"
3. User adds third Thought → counter updates: "12 stocks match"
4. User adds a NOT exclusion Thought → counter updates: "9 stocks match"

### Per-Thought Counts
Each Thought box on the canvas also displays its own pass count. This shows the user exactly where the funnel narrows.

Example display on the canvas:
```
[Thought A: "Weekly Base"]          passes: 412
        |
        AND
        |
[Thought B: "Dip & Reclaim"]       passes: 83
        |
     /     \
    OR      OR
    |        |
[Thought C]  [Thought D]
passes: 7    passes: 5
    |        |
     \      /
    RESULTS: 9                      (3 stocks passed both paths)
```

### Counter Behavior
- Counter recalculates every time a Thought is added, removed, connected, or its parameters change
- If the scan takes more than 1-2 seconds, show a spinner on the counter
- Color coding: Green if results are in a useful range (5-50), yellow if too many (50+), red if zero
- The counter helps the user tune their Idea — too many results means add more filters, zero results means loosen parameters

### Performance Note
For the live counter to feel responsive, the backend needs to evaluate the Idea against the full stock universe quickly. With S&P 500 (dev universe), this should be near-instant. With larger universes, caching intermediate Thought results helps — if the user only changes Thought C, you don't need to re-run Thoughts A and B.

---

## 10. RESULTS OUTPUT

### Results Panel
When the user is satisfied with their Idea, the full results display in a panel below or beside the canvas.

### What Each Result Shows
- Ticker symbol and company name
- Current price
- Path tag: which route through the Idea the stock qualified on (e.g., "Early Breakout" or "Retest & Resume" or "Both")
- Key stats relevant to the Idea (auto-selected based on which Thoughts are in the Idea — if volume Thoughts are present, show volume vs average; if MA Thoughts are present, show distance from key MAs)

### Sort Options
- Alphabetical by ticker
- By volume (highest relative volume first)
- By proximity to breakout level
- By RS ranking
- By number of paths passed (stocks passing multiple paths rank higher)

### Actions on Each Result
- Click to open in the chart tool (integrates with the existing chart tool)
- Click to send to the RUBRICSHIELD Rubric for scoring
- Star/favorite to add to a watchlist
- Export full results list to CSV

### Result Tagging
If a stock passes through multiple OR paths, it appears once in results but is tagged with all qualifying paths. Stocks qualifying on more paths are arguably stronger signals and should be highlighted or sortable by "signal strength" (number of paths passed).

---

## 11. ARCHITECTURE SUMMARY FOR DEVELOPMENT

### Component 1: Indicator Engine (Backend)
- Hardcoded calculation functions for every indicator in the library
- Each function takes raw price/volume/fundamental data and returns a computed value
- Functions are pure math — no AI involved
- Must be fast enough to scan a universe of 5,000-8,000 stocks
- Cache indicator results per stock so they don't recalculate when only downstream Thoughts change

### Component 2: Thought Evaluator (Backend)
- Takes a Thought definition (selected indicators + parameters) and a stock
- Runs each indicator calculation
- Applies the parameter thresholds
- Handles NOT inversion on individual criteria
- Returns boolean: pass or fail

### Component 3: Idea Executor (Backend)
- Takes an Idea definition (connected Thoughts with AND/OR/NOT logic) and the stock universe
- Evaluates each stock through the Idea's logic flow
- Handles Thought-level NOT inversion (exclusion Thoughts)
- Returns the list of passing stocks with path tags
- Supports incremental re-evaluation: when one Thought changes, only re-run affected downstream paths

### Component 4: AI Thought Assistant (Backend + AI API)
- Receives user's plain-English description
- Calls the AI with the indicator library as context
- Returns a proposed Thought definition with parameters
- Can suggest creative indicator combinations
- Can suggest splitting complex descriptions into multiple Thoughts
- User can accept or modify

### Component 5: Visual Idea Builder (Frontend — React Flow)
- Drag-and-drop canvas for Thought boxes (use React Flow / xyflow library)
- Wire connections between boxes
- AND/OR/NOT toggle on connections
- NOT toggle on individual Thought boxes (with red border visual indicator)
- Live result counter — floating total count + per-Thought pass counts
- Color-coded counter (green = useful range, yellow = too many, red = zero)
- Thought library sidebar with categories
- "New Thought" button that opens the AI assistant
- Parameter editing panel when a Thought box is selected (sliders, dropdowns)

### Component 6: Data Layer (Backend)
- Yahoo Finance integration for development (yfinance or yahoo-finance2)
- Stock universe management (S&P 500 for dev, tiered for production)
- Data caching to avoid redundant API calls
- Daily refresh of OHLCV data
- Quarterly refresh of fundamental data
- Swappable data provider interface for production upgrade

### Component 7: Results Display (Frontend)
- List of stocks that passed the Idea
- Path tags showing which route each stock qualified through
- Key stats auto-selected based on which Thoughts are in the Idea
- Sort options (alphabetical, volume, proximity to breakout, RS rank, signal strength)
- One-click to open the stock in the chart tool
- One-click to send to the Rubric for scoring
- Star/favorite for watchlist
- Export to CSV

---

## 12. WORKFLOW: SCANNER TO RUBRIC

1. User builds or selects an Idea in the Idea Builder
2. Scanner runs the Idea against the stock universe
3. Results show qualifying stocks with path tags
4. User clicks a stock to open it in the RUBRICSHIELD Rubric
5. Rubric scores the stock on the 100-point scale (MA Structure, Base Quality, Risk/Reward, Breakout Quality, Stop Loss Quality)
6. User decides whether to trade based on the Rubric score

The Scanner FINDS. The Rubric GRADES. This separation keeps both tools focused and effective.
