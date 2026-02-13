# RUBRICSHIELD Thought Spec: Wedge Pop Detection

## What It Is

The Wedge Pop is Oliver Kell's "Money Pattern" — the moment a stock
confirms it has bottomed and is beginning a new uptrend. After a
pullback or downtrend, the stock consolidates under declining moving
averages with tightening price action, then breaks back up through
those MAs with increased volume. The best Wedge Pops happen via a
gap up through the moving averages.

This Thought detects stocks that are either currently firing a Wedge
Pop or are setting up for one (within the wedge, approaching the MAs).

---

## The Setup Phase (What Happens Before the Pop)

### 1. Prior Downtrend or Pullback

The stock must have been declining or pulling back. This means:

- Price is currently below or near the 10-day and 20-day EMAs
- The 10/20 EMAs are flat or declining (they were acting as
  resistance, pushing price down)
- The stock came from a higher price — this isn't a stock that's
  been dead sideways for months

The prior decline can be:
- A pullback within a larger uptrend (most common, highest quality)
- A correction after an extended move
- A broader downtrend (lower quality, but still valid if other
  criteria are met)

### 2. Volatility Contraction / Wedge Formation

As the decline matures, the price range tightens:

- Recent bars show narrowing high-low ranges compared to the bars
  at the start of the decline
- Price is forming lower highs that converge toward the declining
  10/20 EMAs (the "wedge" shape)
- Ideally, the lows are also rising or flattening (higher lows
  within the wedge), though this isn't strictly required — some
  Wedge Pops come from flat or slightly declining bases

The tightening is the key signal. It means sellers are exhausting
and volatility is compressing — a spring being coiled.

### 3. Volume Drying Up During the Wedge

Volume should be declining during the consolidation phase:

- Recent average volume is lower than the volume during the initial
  decline
- This shows selling pressure is fading
- Low volume inside the wedge = lack of sellers, not lack of
  interest

---

## The Trigger (The Pop Itself)

### 4. Price Reclaims the 10/20 EMA

The stock breaks back above the 10-day and/or 20-day EMA. This can
happen in several ways, ranked by quality:

**Highest quality — Gap up through both EMAs:**
- Today's open is above both the 10 and 20 EMA
- The gap itself shows the street was caught off guard
- Unfilled gap (price doesn't come back down to close it during
  the session) is even stronger

**High quality — Strong bar through both EMAs:**
- Today's candle opens below or near the EMAs but closes decisively
  above both
- Wide range bar (large candle body relative to recent bars)

**Moderate quality — Gradual reclaim:**
- Price works above the 10 EMA first, then the 20 EMA over a
  couple of sessions
- Less explosive but still valid if volume confirms

### 5. Volume Surge on the Pop

The breakout bar (or gap day) must show significantly higher volume
than recent average:

- Volume on the pop day should be at least 1.5x the 20-day average
  volume (preferably 2x+)
- This is the "accumulation volume" that confirms institutions are
  stepping in
- Without the volume surge, the Wedge Pop is suspect — the first
  two failed Wedge Pops on QQQ in Fall 2023 failed precisely
  because there was no accumulation volume

### 6. Descending Trendline Break (Optional but Ideal)

If a descending trendline can be drawn across the recent lower highs,
the pop should also break above that trendline. This is the classic
"wedge" break. In practice, reclaiming the 10/20 EMA usually
coincides with breaking the descending trendline, so this is more
of a visual confirmation than a separate criterion.

---

## Quality Filters (What Makes a Wedge Pop High vs Low Quality)

### Stock Context

- **Best:** Stock was in a Stage 2 uptrend (above rising 200-day MA)
  before the pullback. The Wedge Pop is a resumption, not a reversal
  from a long decline.
- **Good:** Stock is near its 200-day MA. The Wedge Pop could launch
  a new trend.
- **Weaker:** Stock is well below its 200-day MA and the MA is
  declining. This could still work but the odds are lower — the
  larger trend is against you.

### Gap Quality (when applicable)

- Unfilled gap (price doesn't retrace to close the gap intraday)
  is much stronger than a filled gap
- Multiple unfilled gaps in succession after the Wedge Pop is the
  strongest signal of all — this is what the successful QQQ bottom
  in Fall 2023 looked like
- Gap size matters: a 2%+ gap is more significant than a 0.5% gap

### Relative Strength

- Stocks showing relative strength during the market decline
  (falling less than the index, or holding higher while the index
  makes lower lows) are the best Wedge Pop candidates
- These are the new cycle leaders — they're being accumulated even
  during the correction

### Nick Drendel's Additional Layer: Resistance Gap Clearance

The highest quality Wedge Pop gap closes the day above any previous
unfilled resistance gaps. This means the stock hasn't just reclaimed
the moving averages — it's cleared overhead supply in a single move.
The street is maximally caught off guard.

---

## Variants

### Standard Wedge Pop
- Pullback within an uptrend, price wedges into declining 10/20
  EMAs, pops back through on volume.

### Shakeout Gap Wedge Pop
- Same setup but the wedge includes a "shakeout" — a sharp break
  below an obvious support level (prior low, round number, key MA)
  that traps sellers, immediately followed by a gap up reversal.
- "From failed moves come fast moves" — the shakeout adds fuel
  because shorts need to cover.

### Market-Level Wedge Pop
- Apply the same criteria to SPY, QQQ, or IWM to detect potential
  market bottoms. When the index itself fires a Wedge Pop, that's
  your re-entry signal from cash.
- A cluster of individual stock Wedge Pops appearing simultaneously
  is itself a market-level signal, even before the index triggers.

---

## Thought Parameters (User-Configurable)

| Parameter | Default | Description |
|---|---|---|
| emaShort | 10 | Short EMA period |
| emaLong | 20 | Long EMA period |
| minWedgeBars | 8 | Minimum bars in the wedge/consolidation phase |
| maxWedgeBars | 40 | Maximum lookback for the wedge formation |
| minVolumeRatio | 1.5 | Minimum volume on pop day vs 20-day avg |
| minGapPercent | 0 | Minimum gap-up size (0 = no gap required) |
| requireGap | false | If true, only show gap-up Wedge Pops |
| requireUnfilledGap | false | If true, gap must remain unfilled by close |
| rangeContractionPct | 30 | Recent range must be X% tighter than early wedge range |
| volumeDeclinePct | 20 | Volume in wedge must be X% below volume at start of decline |

---

## Detection Output (What the Thought Returns)

For each stock that passes:

```
{
  "wedgePopDetected": true,
  "popType": "gap" | "strong_bar" | "gradual",
  "gapPercent": 3.2,
  "gapFilled": false,
  "volumeRatio": 2.4,
  "wedgeBars": 14,
  "rangeContraction": 45,
  "priceVsEma10": "above",
  "priceVsEma20": "above",
  "priceVs200dma": "above",
  "relativeStrengthVsSpy": 1.15,
  "shakeoutDetected": false,
  "resistanceGapsCleared": 2
}
```

This snapshot feeds into the chart rating system and the AI tuning
loop. Over time, the AI learns which Wedge Pop characteristics
(gap size, volume ratio, wedge duration, etc.) correlate with the
user's thumbs-up ratings and can suggest parameter adjustments.

---

## How It Fits in the Scanner

### As a Standalone Idea
"Show me all stocks in the S&P 500 firing Wedge Pops today."
This is the re-entry scan you run when sitting in cash during a
correction. The results are your new cycle leader candidates.

### Combined with Other Thoughts
"Show me stocks with a flat consolidation base AND a Wedge Pop
trigger." This finds quality base setups where the catalyst (the
pop) has just arrived — the "today is the day" signal layered on
top of structural quality.

### As a Market Health Signal
Count the number of Wedge Pop detections across the S&P 500 each
day. During corrections, this number is near zero. When it spikes
to 10-15+ in a single day, the market is likely bottoming. This
count could feed into your Market Health Dashboard as an additional
breadth-like indicator.
