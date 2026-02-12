# RUBRICSHIELD Scanner — Complete Learning Loop Specification
## UI Changes, Chart Ratings, Schema, Prompt Templates, and Pattern Inference

---

## Part 1: Current State and Gaps

### What Exists Today

The scanner (BigIdea) lets users visually wire together indicator Thoughts
on a canvas to build scan Ideas. After scanning, users review charts in a
detail view and can rate them thumbs-up or thumbs-down. There's an AI Tune
feature (Pro/Admin only) that opens a dialog, shows the failure funnel, and
asks GPT-5.1 to suggest parameter adjustments.

### What's Broken

1. **Ratings are shallow.** Chart ratings only save symbol + up/down + price.
   No scan context, no indicator values, no link to which idea or session
   produced the result.

2. **The AI is blind.** When tuning, the AI only sees aggregate counts like
   "8 up, 1 down" in a single sentence. It has no idea which stocks were
   good or bad, what the indicator values looked like, or what distinguishes
   a thumbs-up stock from a thumbs-down one.

3. **No rescan after tuning.** The user applies suggestions but must manually
   re-run the scan. The `resultCountAfter` field never gets filled, so
   there's no measurement of whether tuning actually helped.

4. **No accepted tracking.** We don't record which suggestions the user
   applied vs skipped.

5. **No session feedback.** No way for users to say "this tuning session
   was helpful" or not.

6. **No learning over time.** Since nothing is tracked, the AI starts from
   scratch every single time.

---

## Part 2: UI Changes — The Complete Flow

### Step 1: User Runs a Scan

No visible change. User configures their idea on the canvas and clicks
the scan button. Behind the scenes, the system now mints a **scan session**
with a unique sessionId and stores the full config snapshot and result set.

### Step 2: User Reviews Charts and Rates Them

This is the chart detail view (the NVDA screen). The top of the view
already displays each Thought's pass/fail status with computed values:

- Flat consolidation base detection: 29 bars, top $194.49, bottom $179.20,
  depth 8.53%
- Volume dry-up: 11 bars, ratio 1.03
- 50 SMA above 200 SMA: $194.34 vs $170.00, spread 14.3%

**What changes when the user clicks thumbs-up or thumbs-down:**

Currently, a rating saves only: `{ symbol: "NVDA", rating: "up", price: 190.05 }`

After the change, a rating saves:

```json
{
  "symbol": "NVDA",
  "rating": "up",
  "price": 190.05,
  "sessionId": "sess_abc123",
  "ideaId": "idea_xyz789",
  "patternType": "flat_base",
  "indicatorSnapshot": {
    "flat_consolidation_base": {
      "passed": true,
      "detectedPeriod": 29,
      "baseTopPrice": 194.49,
      "baseBottomPrice": 179.20,
      "baseDepth": 8.53,
      "avgBaseVolume": 57925624
    },
    "volume_dryup": {
      "passed": true,
      "recentBars": 11,
      "volumeRatio": 1.03,
      "baselineRatio": 1.03
    },
    "sma_50_above_200": {
      "passed": true,
      "sma50": 194.34,
      "sma200": 170.00,
      "spread": 14.3
    }
  }
}
```

**The indicator snapshot data is already computed and displayed on screen.**
The only backend change is persisting it alongside the rating. No new UI
elements are needed on the chart view — thumbs-up and thumbs-down work
exactly the same as before from the user's perspective.

**Why this matters for the AI:**

Instead of the AI seeing "8 up, 1 down," it now sees:

- "8 thumbs-up stocks all had volume ratios below 0.9 and base
  periods over 20 bars"
- "The 1 thumbs-down stock had a volume ratio of 1.1 (barely passing)
  and a short 12-bar base"
- "Therefore: tighten the volume ratio threshold and raise minimum
  base period"

The chart-level ratings become labeled training examples of what the
user considers a good vs bad setup, complete with the specific indicator
values that produced that judgment.

### Step 3: User Clicks "Tune"

The AI Scan Tuning dialog opens. This is the existing modal with the
failure funnel summary and the text input for the user's request.

**What changes at this stage:**

A small text line appears above the funnel summary when historical
tuning data exists for this idea:

> *Based on 4 previous tuning sessions for this idea*

This is collapsible (click to expand and see a brief history summary).
Most users will ignore it. Power users can see what was tried before.

The user types their request (e.g., "Loosen the Volume Dry Up") and
clicks "Get Suggestions" — same as today.

### Step 4: AI Suggestions — The Modified Tuning Panel

The suggestion cards appear as they do today. Each card shows:

- The Thought name (e.g., "Volume dry-up")
- The parameter name (e.g., "maxRatio")
- The before → after values (e.g., 1.0 → 1.25)
- A plain-English explanation

**What changes:**

**4a. Apply buttons become toggles.**

Currently, "Apply" is a one-way action with no visual state change.
After the change:

- Clicking "Apply" switches the button to a green checkmark state:
  **"✓ Applied"**
- Clicking "✓ Applied" again reverts it (un-applies the suggestion)
- The user can selectively apply some suggestions and skip others
- The visual state makes it clear which suggestions are active

**4b. The "Done" button becomes "Apply & Rescan."**

- "Apply & Rescan" is only enabled when at least one suggestion has
  been applied
- "Try Again" remains unchanged (re-prompts the AI)
- A new "Cancel" or "X" allows closing without applying anything

**4c. Confidence indicators (after Tier 2/3 data exists).**

Each suggestion card gains a small confidence badge:

- 🟢 High confidence — "This direction worked in 4/5 previous sessions"
- 🟡 Medium confidence — "Limited data, but consistent with cross-idea patterns"
- 🔴 Experimental — "No historical data for this parameter change"

This only appears once the system has accumulated enough tuning history
to be meaningful. Initially all suggestions would show no badge.

### Step 5: Apply & Rescan — The Comparison View

When the user clicks "Apply & Rescan," three things happen in sequence:

**5a. Config diff is captured.**

The system snapshots `configBefore` and `configAfter`, and records
which suggestions were accepted vs skipped:

```json
{
  "acceptedSuggestions": [
    {
      "thoughtName": "volume_dryup",
      "param": "maxRatio",
      "from": 1.0,
      "to": 1.25,
      "source": "ai"
    },
    {
      "thoughtName": "volume_dryup",
      "param": "recentBars",
      "from": 6,
      "to": 8,
      "source": "ai"
    }
  ],
  "skippedSuggestions": [
    {
      "thoughtName": "flat_consolidation_base",
      "param": "maxRange",
      "from": 16.5,
      "to": 20,
      "source": "ai"
    }
  ]
}
```

**5b. Auto-rescan executes.**

The backend immediately runs the scan with the new config. A new
scan session is created. The modal shows a brief loading state:
"Rescanning with updated parameters..."

**5c. Comparison view replaces the suggestions list.**

The modal content transitions to show:

```
┌─────────────────────────────────────────────────┐
│  TUNING RESULTS                                 │
│                                                 │
│  Before: 47 results  →  After: 31 results       │
│                                                 │
│  ✅ Kept 7 of 8 thumbs-up stocks                │
│  ✅ Dropped 1 of 1 thumbs-down stocks            │
│  🆕 5 new stocks appeared                        │
│                                                 │
│  ─────────────────────────────────────────────── │
│                                                 │
│  Changes applied:                                │
│  • Volume dry-up maxRatio: 1.0 → 1.25           │
│  • Volume dry-up recentBars: 6 → 8              │
│                                                 │
│  ─────────────────────────────────────────────── │
│                                                 │
│  Was this tuning session helpful?                │
│                                                 │
│         👍 Helpful       👎 Not helpful           │
│                                                 │
│                              [ Close ]           │
└─────────────────────────────────────────────────┘
```

**Key details about the comparison view:**

- "Kept X of Y thumbs-up stocks" — the system cross-references the
  new result set against the user's chart ratings from the previous
  session. If NVDA was rated thumbs-up and still appears in the new
  results, it's "kept." If it disappeared, it's "dropped" (bad).

- "Dropped X of Y thumbs-down stocks" — same logic for thumbs-down
  ratings. Dropping thumbs-down stocks is a success signal.

- "New stocks appeared" — symbols in the new results that weren't in
  the previous results. The user can click through to review and rate
  these if they want, starting another loop iteration.

- The overlap analysis requires that the user rated at least some
  charts before tuning. If they tuned without rating any charts, the
  comparison view just shows the before/after result count without the
  retention breakdown.

### Step 6: Session Feedback

The 👍/👎 at the bottom of the comparison view is the session feedback.
One click stores the verdict on the tuning history row.

- For Pro/Admin users, clicking either button can optionally expand a
  small text field: "What would have made this better?" This is purely
  optional — the binary signal alone is valuable.

- After clicking, the button shows as selected (e.g., "👍 Helpful ✓")
  and the user clicks "Close" to dismiss the modal.

- The scan results panel on the right side of the main screen now
  reflects the new (post-rescan) results, so the user can immediately
  continue reviewing charts with the updated set.

### Step 7: The Loop Continues

The user is now looking at the post-rescan results. They can:

1. Review and rate the new charts (creating new chart ratings linked
   to the new scan session)
2. Tune again (opening a new tuning session that now references the
   previous one's history)
3. Move on to other work

Each iteration adds more data to the learning system.

---

## Part 3: How Chart Ratings Feed the Three Tiers

The thumbs-up/down on individual charts is the foundational data source
for all three learning tiers. Here's exactly how each rating propagates
through the system:

### Tier 1 — Idea-Specific Learning

When the AI tunes this specific idea, it receives the rated charts
with their full indicator snapshots. This lets it say:

> "Your 7 thumbs-up stocks for this flat base idea all had volume
> ratios below 0.9 and base periods above 22 bars. Your 2 thumbs-down
> stocks had volume ratios above 1.0 and shorter base periods.
> Recommendation: tighten maxRatio from 1.25 to 1.0 and raise
> minPeriod from 15 to 20."

The AI sees patterns *within this idea's ratings* that point to
specific parameter adjustments.

### Tier 2 — Thought-Level Learning

The same chart ratings, aggregated across all ideas that use the
Volume Dry Up Thought, reveal patterns about that Thought's behavior
regardless of which idea it's in:

> "Across 6 different ideas using the Volume Dry Up Thought, stocks
> rated thumbs-up have an average volume ratio of 0.82, while stocks
> rated thumbs-down have an average of 1.15. The maxRatio sweet spot
> is 1.0-1.25 based on 120 rated charts."

This helps when a user creates a brand new idea that includes Volume
Dry Up — the system already knows how that Thought's parameters
correlate with good/bad ratings.

### Tier 3 — Pattern-Type Learning

The same chart ratings, grouped by pattern type (flat base, VCP,
ascending, etc.), reveal which indicator profiles matter most for
each pattern type:

> "For flat base patterns, volume dry-up is the strongest predictor
> of thumbs-up ratings (correlation 0.72). For ascending base patterns,
> SMA structure spread is more predictive (correlation 0.68) while
> volume dry-up barely matters (correlation 0.15)."

This helps the AI prioritize which parameters to suggest tuning based
on the type of pattern being scanned.

---

## Part 4: Automatic Pattern Inference

Users should never have to classify their ideas manually. The system
infers pattern type from three sources, in priority order.

### Source 1: Natural Language Query Keywords

When a user types a query like "Show me a VCP style base with the
last few bars breaking out," keyword extraction identifies:

**Pattern Type Signals:**

| Keywords in Query | Inferred patternType |
|---|---|
| VCP, volatility contraction | `vcp` |
| flat base, flat consolidation, sideways | `flat_base` |
| cup and handle, cup, rounded bottom | `cup_and_handle` |
| ascending base, higher lows, staircase | `ascending_base` |
| descending base, lower highs | `descending_base` |
| HTF, high tight flag, flag after run | `high_tight_flag` |
| IPO base, post-IPO | `ipo_base` |
| double bottom, W pattern | `double_bottom` |
| breakout, breaking out | (modifier, not a base type) |
| pullback, retest | (modifier, not a base type) |

**Setup Phase Signals:**

| Keywords | Inferred setupPhase |
|---|---|
| breaking out, last few bars breaking | `breakout` |
| forming, building, constructing | `formation` |
| pulling back, retesting | `pullback` |
| tightening, contracting, narrowing | `contraction` |

**Quality Preference Signals:**

| Keywords | Inferred preference |
|---|---|
| tight, narrow range | Prefers low-volatility bases |
| volume dry up, quiet volume | Prefers declining volume in base |
| strong, powerful, big move | Prefers high relative strength |
| clean, textbook | Prefers well-defined pattern shapes |

Example extraction from "Show me a VCP style base with the last few
bars breaking out":

```json
{
  "patternType": "vcp",
  "setupPhase": "breakout",
  "qualityPreferences": ["tight_consolidation"],
  "rawQuery": "Show me a VCP style base with the last few bars breaking out"
}
```

### Source 2: Thought Composition on Canvas (Fallback)

If the user doesn't type a query and just drags Thoughts manually:

| Thought Combination | Inferred patternType |
|---|---|
| Flat consolidation base + Volume dry up | `flat_base` |
| Flat consolidation base + Volume dry up + Tight range | `vcp` |
| Base detection + Higher lows filter | `ascending_base` |
| Base detection + Prior advance + Tight range | `high_tight_flag` |
| Cup detection Thought | `cup_and_handle` |

### Source 3: Parameter Values (Tertiary Signal)

Even parameter values carry information:

- `minPeriod: 5-15` bars → likely a flag or short consolidation
- `minPeriod: 20-40` bars → likely a proper base
- `maxRange: 5-10%` → tight pattern (VCP, HTF)
- `maxRange: 15-30%` → wider pattern (cup, ascending)

This doesn't override keyword or composition inference but adds a
confidence signal for edge cases.

---

## Part 5: Schema

### New Table: `idea_metadata`

Stores the inferred pattern classification. Populated automatically
when an idea is created or saved — the user never touches this.

```sql
CREATE TABLE idea_metadata (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  ideaId          TEXT NOT NULL REFERENCES ideas(id),
  userId          TEXT NOT NULL,

  -- Auto-inferred fields
  patternType     TEXT,
  setupPhase      TEXT,
  qualityPrefs    JSONB,
  thoughtComposition JSONB,

  -- Source of inference
  inferenceSource TEXT,      -- 'nlp_query', 'thought_composition', 'manual_override'
  rawQuery        TEXT,
  confidence      REAL,      -- 0.0-1.0

  createdAt       TIMESTAMPTZ DEFAULT NOW(),
  updatedAt       TIMESTAMPTZ DEFAULT NOW()
);
```

### New Table: `scan_sessions`

The missing spine that connects everything. Created every time the
user clicks Scan.

```sql
CREATE TABLE scan_sessions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  ideaId          TEXT NOT NULL REFERENCES ideas(id),
  userId          TEXT NOT NULL,
  scanConfig      JSONB NOT NULL,
  resultCount     INTEGER NOT NULL,
  resultSymbols   TEXT[],
  patternType     TEXT,
  createdAt       TIMESTAMPTZ DEFAULT NOW()
);
```

### Updated Table: `chart_ratings`

Now stores the full indicator profile alongside the rating.

```sql
CREATE TABLE chart_ratings (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  sessionId         TEXT NOT NULL REFERENCES scan_sessions(id),
  ideaId            TEXT NOT NULL REFERENCES ideas(id),
  userId            TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  rating            TEXT NOT NULL,    -- 'up' or 'down'
  price             REAL,

  indicatorSnapshot JSONB NOT NULL,
  -- Example:
  -- {
  --   "flat_consolidation_base": {
  --     "passed": true,
  --     "detectedPeriod": 29,
  --     "baseTopPrice": 194.49,
  --     "baseBottomPrice": 179.20,
  --     "baseDepth": 8.53,
  --     "avgBaseVolume": 57925624
  --   },
  --   "volume_dryup": {
  --     "passed": true,
  --     "recentBars": 11,
  --     "volumeRatio": 1.03
  --   },
  --   "sma_50_above_200": {
  --     "passed": true,
  --     "sma50": 194.34,
  --     "sma200": 170.00,
  --     "spread": 14.3
  --   }
  -- }

  patternType       TEXT,
  createdAt         TIMESTAMPTZ DEFAULT NOW()
);
```

### Updated Table: `tuning_history`

Complete lifecycle tracking for each tuning session.

```sql
CREATE TABLE tuning_history (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  sessionId             TEXT NOT NULL REFERENCES scan_sessions(id),
  ideaId                TEXT NOT NULL REFERENCES ideas(id),
  userId                TEXT NOT NULL,

  -- What the AI saw
  userPrompt            TEXT,
  funnelData            JSONB NOT NULL,
  ratingsSummary        JSONB,

  -- What the AI suggested
  configBefore          JSONB NOT NULL,
  suggestedChanges      JSONB NOT NULL,
  -- Example:
  -- [
  --   {
  --     "thoughtName": "volume_dryup",
  --     "param": "maxRatio",
  --     "from": 1.0,
  --     "to": 1.25,
  --     "reasoning": "Many tickers are only slightly above 1.0x..."
  --   }
  -- ]

  -- What the user actually did
  acceptedSuggestions   JSONB,
  skippedSuggestions    JSONB,
  configAfter           JSONB,

  -- What happened after rescan
  resultCountBefore     INTEGER,
  resultCountAfter      INTEGER,
  retainedUpSymbols     TEXT[],
  droppedUpSymbols      TEXT[],
  droppedDownSymbols    TEXT[],
  retainedDownSymbols   TEXT[],
  newSymbols            TEXT[],

  -- User verdict
  userFeedback          TEXT,       -- 'helpful' or 'unhelpful'
  userFeedbackNote      TEXT,       -- Optional (Pro/Admin only)

  -- Cross-idea indexing
  patternType           TEXT,
  thoughtsInvolved      TEXT[],

  createdAt             TIMESTAMPTZ DEFAULT NOW()
);
```

### New Table: `thought_tuning_aggregates` (Precomputed Cache)

Powers Tier 2 and Tier 3 prompt generation. Refreshed nightly or
after every N tuning sessions.

```sql
CREATE TABLE thought_tuning_aggregates (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  thoughtName           TEXT NOT NULL,
  paramName             TEXT NOT NULL,
  patternType           TEXT,          -- NULL = all patterns

  -- Directional stats
  directionUp           INTEGER DEFAULT 0,
  directionDown         INTEGER DEFAULT 0,
  avgChangeSize         REAL,

  -- Acceptance stats
  timesAccepted         INTEGER DEFAULT 0,
  timesSkipped          INTEGER DEFAULT 0,

  -- Outcome stats
  helpfulWhenAccepted   INTEGER DEFAULT 0,
  unhelpfulWhenAccepted INTEGER DEFAULT 0,

  -- Derived sweet spot
  avgAcceptedValue      REAL,
  minAcceptedValue      REAL,
  maxAcceptedValue      REAL,

  -- Scope
  sessionCount          INTEGER DEFAULT 0,
  userCount             INTEGER DEFAULT 0,

  updatedAt             TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(thoughtName, paramName, patternType)
);
```

---

## Part 6: AI Prompt Templates

### Tier 1 — Idea-Specific History (always included)

```
=== THIS IDEA'S TUNING HISTORY ===

Idea: "Flat Consolidation + Volume Dry Up + 50/200 SMA"
Pattern type: flat_base (auto-detected from query keywords)
Total tuning sessions: 5

RATED CHARTS WITH INDICATOR PROFILES:

Thumbs-up stocks (8):
  NVDA: volume_ratio=0.78, base_period=29, base_depth=8.5%, sma_spread=14.3%
  AAPL: volume_ratio=0.65, base_period=34, base_depth=6.2%, sma_spread=11.1%
  MSFT: volume_ratio=0.82, base_period=25, base_depth=7.8%, sma_spread=9.4%
  ... (5 more)

  Common profile: volume_ratio avg 0.76, base_period avg 28,
  base_depth avg 7.2%

Thumbs-down stocks (1):
  XYZ: volume_ratio=1.10, base_period=12, base_depth=14.1%, sma_spread=4.2%

  Key differences from thumbs-up: higher volume ratio (1.10 vs 0.76 avg),
  shorter base (12 vs 28 avg), deeper base (14.1% vs 7.2% avg)

PREVIOUS TUNING SESSIONS:

Session 2025-02-10:
  User asked: "Tighten the base quality"
  Applied: flat_consolidation_base.maxRange 15% → 12%
  Skipped: volume_dryup.maxRatio 1.25 → 1.0
  Results: 31 → 24 (-23%)
  Retained 6/7 thumbs-up, dropped 1/1 thumbs-down
  User rated: helpful

Session 2025-02-08:
  User asked: "Loosen the Volume Dry Up"
  Applied: volume_dryup.maxRatio 1.0 → 1.25,
           volume_dryup.recentBars 6 → 8
  Skipped: flat_consolidation_base.maxRange 16.5 → 20
  Results: 9 → 31 (+244%)
  Retained 8/8 thumbs-up (all kept)
  User rated: helpful

Session 2025-02-01:
  User asked: "Find tighter bases with less noise"
  Applied: flat_consolidation_base.minPeriod 10 → 8
  Results: 47 → 52 (+11%, went wrong direction)
  Lost 2 thumbs-up, gained 3 thumbs-down
  User rated: unhelpful

PATTERNS FOR THIS IDEA:
  - Volume dry up loosening: consistently helpful (2/2)
  - User always skips maxRange increases (prefers tight bases)
  - Reducing minPeriod made things worse; user prefers longer bases
```

### Tier 2 — Thought-Level Insights (Pro/Admin, when data exists)

```
=== CROSS-IDEA INSIGHTS: VOLUME DRY UP THOUGHT ===
(Based on 28 tuning sessions across 6 different ideas)

Parameter: maxRatio
  Sweet spot: 1.15 - 1.30 (accepted and helpful 18/22 times)
  Values below 1.0 too restrictive (rejected 8/10 times)
  Values above 1.5 provide little filtering value

Parameter: recentBars
  Most users settle between 7-10 bars
  Increasing 6 → 8 was most common accepted change (12 times)
  Going above 12 rated unhelpful 4/5 times

Parameter: baselineRatio
  Rarely tuned (only 3 sessions). Default works for most setups.

=== CROSS-IDEA INSIGHTS: FLAT CONSOLIDATION BASE THOUGHT ===
(Based on 45 tuning sessions across 8 different ideas)

Parameter: maxRange
  Tight-pattern users prefer 10-15%
  Wide-pattern users use 20-30%
  This user consistently skips increases → prefers tight

Parameter: minPeriod
  Strong signal: values below 15 produce thumbs-down stocks
  Sweet spot for this user: 20-30 bars
  Decreasing was rated unhelpful 7/9 times across all users

Parameter: period (lookback window)
  30-40 bars most common. Increasing generally rated helpful.
```

### Tier 3 — Pattern-Type Insights (Admin/Enterprise, when data exists)

```
=== GENERAL INSIGHTS: FLAT BASE PATTERNS ===
(Based on 45 sessions from 12 users)

What works:
  - Tight volume dry-up filters (maxRatio 1.0-1.3) consistently produce
    thumbs-up stocks. Flat bases benefit more from volume quality than
    most other pattern types.
  - Longer minimum base periods (20+ bars) strongly correlate with
    thumbs-up ratings. Short flat bases are often noise.
  - SMA structure rarely tuned. Acts as binary gate. Don't waste
    suggestions on SMA params for flat base ideas.

What doesn't work:
  - Loosening maxRange above 20% turns flat bases into "anything goes."
  - RSI filters tried 8 times, rated helpful only once. Flat bases
    are about price structure, not momentum.

How flat bases differ:
  - VCP: needs tighter maxRange (10-12%), multiple contraction detection.
    Volume dry-up matters but less than for flat bases.
  - Ascending: SMA spread more predictive than volume dry-up. Tuning
    volume for ascending was unhelpful 6/8 times.
  - Cup and handle: needs wider maxRange (25-35%), longer periods.
    Tight flat-base params kill cup detection.
```

### Complete System Prompt for the AI Tuning Agent

```
You are the AI Tuning Agent for RUBRICSHIELD Scanner. Your job is to
suggest parameter adjustments that will improve scan results based on
the user's ratings and tuning history.

PRINCIPLES:
1. Never suggest changes that contradict demonstrated preferences.
   If the user consistently skips a type of suggestion, stop making it.
2. Weight recent sessions more heavily than older ones.
3. Idea-specific history is the strongest signal. Cross-idea and
   pattern-type insights are supporting evidence, not overrides.
4. When a parameter change was tried before and rated unhelpful,
   do not suggest the same direction unless you explain what's different.
5. Prefer small incremental changes. One or two targeted adjustments
   beat five simultaneous changes.
6. Reference specific evidence: "Based on your last session, loosening
   maxRatio kept all your thumbs-up stocks while adding 22 candidates."
7. When chart ratings include indicator snapshots, identify the specific
   indicator values that differentiate thumbs-up from thumbs-down stocks
   and target your suggestions at closing that gap.

CURRENT SESSION CONTEXT:
[Insert: failure funnel data]
[Insert: user's natural language request]
[Insert: current scan config]
[Insert: chart ratings with indicator snapshots]

HISTORICAL CONTEXT:
[Insert: Tier 1 idea-specific history]
[Insert: Tier 2 thought-level aggregates if available]
[Insert: Tier 3 pattern-type insights if available]

USER'S RATING PATTERNS:
[Insert: indicator profiles that correlate with up vs down ratings]

Suggest 2-5 specific parameter changes. For each provide:
- Thought name and parameter name
- Current value and suggested new value
- Plain-English explanation referencing evidence where available
- Confidence level (high/medium/low) based on supporting data
```

---

## Part 7: The Complete Pipeline (How It All Connects)

```
User types query ──→ Keyword extraction ──→ patternType assigned
       │                                          │
       ▼                                          ▼
User wires Thoughts ──→ Composition inference ──→ (fallback if no query)
       │
       ▼
User clicks Scan ──→ scan_session created
       │               scanConfig + resultCount stored
       │
       ▼
User reviews charts ──→ Clicks 👍 or 👎 on each chart
       │                    │
       │                    ▼
       │               chart_rating stored WITH indicatorSnapshot
       │               (the values already displayed on screen)
       │
       ▼
User clicks Tune ──→ AI Tuning dialog opens
       │               AI receives:
       │                 • Current funnel + config
       │                 • Rich ratings with indicator profiles
       │                 • Tier 1: This idea's history
       │                 • Tier 2: Cross-idea Thought stats
       │                 • Tier 3: Pattern-type insights
       │
       ▼
AI suggests changes ──→ User toggles Apply on each card
       │                    (some applied, some skipped)
       │
       ▼
User clicks "Apply & Rescan"
       │  ──→ configBefore/configAfter captured
       │  ──→ acceptedSuggestions/skippedSuggestions recorded
       │  ──→ Auto-rescan executes with new config
       │  ──→ New scan_session created
       │
       ▼
Comparison view shown
       │  ──→ Before: 47 → After: 31
       │  ──→ Kept 7/8 thumbs-up
       │  ──→ Dropped 1/1 thumbs-down
       │  ──→ 5 new stocks
       │
       ▼
User rates session ──→ 👍 Helpful or 👎 Not helpful
       │                    stored in tuning_history.userFeedback
       │
       ▼
User closes modal ──→ Results panel shows post-rescan stocks
       │                 User can rate new charts (new loop iteration)
       │
       ▼
Aggregates refreshed ──→ thought_tuning_aggregates updated
       │
       ▼
Next tuning session is smarter
```

---

## Part 8: Implementation Priority

### Phase 1 — Pattern Inference + Rich Ratings

1. Add `idea_metadata` table with keyword extraction on idea save
2. Add `scan_sessions` table (mint session on every scan)
3. Populate `indicatorSnapshot` on chart ratings (data already computed)

This is the foundation. Low UI effort, moderate backend effort.

### Phase 2 — Accepted Tracking + Auto-Rescan + Comparison View

1. Make Apply buttons toggleable in the tuning dialog
2. Change "Done" to "Apply & Rescan"
3. Capture config diff and accepted/skipped suggestions
4. Execute auto-rescan and compute overlap analysis
5. Build the comparison view inside the existing modal

Moderate UI effort, moderate backend effort. Biggest user-facing impact.

### Phase 3 — Tier 1 Historical Context in AI Prompt

1. Query tuning_history by ideaId when building the AI prompt
2. Include rated chart indicator profiles in prompt
3. Add the "Based on N previous sessions" line in the tuning dialog

Low UI effort, moderate prompt engineering effort. Immediate quality
improvement in AI suggestions.

### Phase 4 — Tier 2/3 Aggregates + Cross-Idea Learning

1. Build `thought_tuning_aggregates` table with refresh logic
2. Add Tier 2 and Tier 3 sections to the AI prompt
3. Add confidence badges to suggestion cards

Moderate effort. This is where the SaaS network effect begins.

### Phase 5 — Session Feedback Loop

1. Add 👍/👎 to the comparison view
2. Use feedback to weight historical examples in prompts
3. Optional free-text for Pro/Admin users

Low effort. Requires Phases 2-4 to be meaningful.

---

## Part 9: SaaS Tier Differentiation

| Capability | Free | Pro | Admin |
|---|---|---|---|
| Tier 1 (own idea history) | ✅ | ✅ | ✅ |
| Tier 2 (Thought-level, own data) | ❌ | ✅ | ✅ |
| Tier 2 (Thought-level, community) | ❌ | ❌ | ✅ |
| Tier 3 (pattern-type intelligence) | ❌ | ❌ | ✅ |
| AI Tune feature | ❌ | ✅ | ✅ |
| Tuning sessions retained | Last 3 | Last 20 | Unlimited |
| Session feedback | ❌ | ✅ | ✅ |
| Confidence badges | ❌ | ✅ | ✅ |

Every Pro and Admin user who tunes their scans contributes to the
collective intelligence pool. The more users tune, the better Tier 2
and Tier 3 become for everyone. That's a genuine network effect that
makes the product stickier and harder for competitors to replicate —
they'd need the accumulated tuning data, not just the code.

---

## Part 10: The Scanner-Rubric Bridge (Future)

The per-symbol indicator snapshots from rated charts are essentially
rubric inputs. A thumbs-up stock with values like:

```
{ sma_distance: 1.2, volume_ratio: 0.78, base_depth: 8.5% }
```

...is a labeled data point saying "this is what a good setup looks
like according to this user."

Over time, this dataset could auto-calibrate rubric scoring weights.
The scanner and the rubric start teaching each other — the scanner
finds candidates, the rubric scores them, the ratings validate both,
and the tuning optimizes the scanner to produce higher-rubric-score
candidates.

That's the full RUBRICSHIELD integration vision, achieved incrementally
through the phases above.
