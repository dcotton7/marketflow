# Indicator Library Audit Report
**Date:** 2026-02-18
**Total Indicators:** 54

## Category Breakdown

| Category | Count | Notes |
|----------|-------|-------|
| Price Action | 17 | Largest category - likely has redundancy |
| Moving Averages | 9 | Many variations of MA comparisons |
| Relative Strength | 7 | Mix of RS and momentum oscillators |
| Volume | 5 | Several measure similar concepts |
| Volatility | 5 | Overlap with Price Action tightness indicators |
| Fundamental | 4 | Simple filters, likely needed |
| Momentum | 3 | Overlap with Relative Strength category |
| Intraday | 3 | Specific use case, keep separate |
| Consolidation | 1 | CB-1 is unique scanner |

---

## Critical Duplicates & Overlaps

### 🔴 HIGH PRIORITY - Clear Duplicates

#### 1. **PA-10 "Price Gap Detection" vs ITD-3 "Gap Detection"**
**Status:** DUPLICATE - Same functionality
- PA-10: Daily timeframe gap detection (lookback, minGapPct, direction)
- ITD-3: Intraday gap detection (same params)
- **Recommendation:** MERGE → Keep ITD-3 renamed as "Gap Detection" with timeframe param
- **Rationale:** ITD-3 is more specific, PA-10 adds nothing new

#### 2. **VOL-2 "Volume Trend" vs PA-16 "Volume Fade"**
**Status:** 90% OVERLAP - Different framing, same measurement
- VOL-2: Compares recent vs baseline volume (increasing/decreasing direction)
- PA-16: Recent volume fade vs baseline (specifically for bases)
- **Recommendation:** CONSOLIDATE → Keep VOL-2 with better params, remove PA-16
- **Rationale:** VOL-2 is more flexible (bidirectional), PA-16 is just "decreasing" mode

#### 3. **PA-4 "Base Depth" vs PA-6 "Distance from 52-Week High"**
**Status:** OVERLAP - Both measure pullback depth
- PA-4: Current pullback from recent high (configurable lookback)
- PA-6: Distance from 52-week high specifically
- **Recommendation:** KEEP BOTH but clarify purposes
  - PA-4: General pullback depth (any timeframe)
  - PA-6: Specifically 52-week positioning (stage analysis)

#### 4. **PA-9 "VCP Tightness" vs PA-14 "Tightness Ratio"**
**Status:** DIFFERENT but confusing naming
- PA-9: Multi-segment contracting volatility pattern (specific O'Neil pattern)
- PA-14: Daily range comparison (general tightness)
- **Recommendation:** RENAME PA-14 → "Daily Range Contraction" to avoid confusion
- **Rationale:** "Tightness" implies VCP, but PA-14 is simpler

### 🟡 MEDIUM PRIORITY - Consolidation Candidates

#### 5. **MA-1 "SMA Value" + MA-2 "EMA Value" + MA-8 "MA Comparison"**
**Status:** Could consolidate
- MA-1: Price vs single SMA (above/below)
- MA-2: Price vs single EMA (above/below)
- MA-8: Two MAs comparison (fast vs slow)
- **Recommendation:** Consider merging MA-1 + MA-2 into single "Price vs MA" with type selector
- **Rationale:** Reduces cognitive load, simpler library

#### 6. **PA-12 "Prior Price Advance" vs PA-13 "Smooth Trending Advance"**
**Status:** PA-13 is stricter version of PA-12
- PA-12: Simple gain % check before base
- PA-13: Gain % + max drawdown + SMA adherence (quality check)
- **Recommendation:** KEEP BOTH
- **Rationale:** PA-13 is "PA-12 with quality filters" - distinct use cases

#### 7. **VOL-1 "Volume vs Average" vs VOL-5 "Volume Surge"**
**Status:** Similar but different thresholds
- VOL-1: General volume multiple check (1.5x+ typical)
- VOL-5: Specifically finds spikes (2x+, single bar)
- **Recommendation:** CONSOLIDATE → Single "Volume Spike" indicator
- **Rationale:** VOL-1 with minMultiple=1.5 does same as VOL-5

#### 8. **VLT-2 "ATR Contraction/Expansion" vs VLT-3 "Daily Range vs Average"**
**Status:** Measure same concept differently
- VLT-2: Compares current ATR to ATR's own history
- VLT-3: Compares recent daily range to historical average
- **Recommendation:** KEEP VLT-3, REMOVE VLT-2
- **Rationale:** VLT-3 is simpler and more intuitive

### 🟢 LOW PRIORITY - Minor Overlaps

#### 9. **RS-5 "MACD" vs MOM-3 "MACD Histogram"**
**Status:** Different but related
- RS-5: MACD line vs signal line crossover
- MOM-3: MACD histogram slope/direction
- **Recommendation:** KEEP BOTH
- **Rationale:** Different aspects of MACD - both useful

#### 10. **MA-7 "MA Crossover" vs MA-9 "Price Crosses MA"**
**Status:** Different patterns
- MA-7: Two MAs crossing each other
- MA-9: Price crossing a single MA
- **Recommendation:** KEEP BOTH
- **Rationale:** Fundamentally different setups

---

## Indicators Missing (Based on User Requests)

### Requested but Not in Library:

1. **"Consecutive Up Days" / "Consecutive Down Days"**
   - User repeatedly requests this
   - No core indicator exists
   - Only available via DSL custom indicators
   - **Action:** CREATE as core indicator with search mode support

2. **"Price Change Over N Bars"** (forward-looking)
   - Needed for "updays then 5% decline" patterns
   - No indicator measures change from a historical point forward
   - **Action:** CREATE as new indicator

3. **"Multi-Base Chaining"**
   - Users want "base → advance → base → advance" sequences
   - CB-1 can find ONE historical base
   - No support for finding multiple sequential bases
   - **Action:** Enhance CB-1 or create separate indicator

---

## Recommendations Summary

### Remove (6 indicators):
- **PA-10** (duplicate of ITD-3)
- **PA-16** (duplicate of VOL-2)
- **VLT-2** (redundant with VLT-3)
- **VOL-5** (consolidate into VOL-1)
- Consider: **MA-1** + **MA-2** merge (reduce MA clutter)

### Rename (2 indicators):
- **PA-14** → "Daily Range Contraction" (avoid VCP confusion)
- **MA-8** → "MA Relationship" (clearer than "MA Comparison")

### Create (3 indicators):
- **"Consecutive Days Pattern"** (search mode, forward/backward)
- **"Price Change Over Period"** (forward-looking measurement)
- **"Multi-Base Finder"** (chain multiple historical bases)

### Keep As-Is (43 indicators):
- Most indicators serve distinct purposes
- PA-3, CB-1, PA-12, PA-13, PA-14, PA-15 are core building blocks
- RS indicators are all different aspects of relative strength
- Volume indicators (VOL-3, VOL-4) measure unique patterns

---

## Net Result:
- **Before:** 54 indicators
- **After Cleanup:** 48-51 core indicators (remove 3-6, add 3 new)
- **Reduction:** ~10% fewer indicators, but more focused library
- **Improvement:** Clearer purpose for each, no functional gaps

---

## Next Steps:

1. **User Approval:** Review removals and renames
2. **Create Missing Indicators:** Add the 3 requested patterns
3. **Proceed with Temporal Linking:** Add skipBars to remaining indicators
