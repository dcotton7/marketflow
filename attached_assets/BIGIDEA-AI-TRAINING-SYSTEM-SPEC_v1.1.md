# BigIdea AI Training System - Product Specification

## Document Version
- **Version:** 1.1
- **Date:** February 15, 2026
- **Status:** Draft

---

## Executive Summary

BigIdea AI Training System transforms the scan engine from a prompt-to-indicator translation tool into a **learning system** with two forms of intelligence:

1. **Static Knowledge** - Expert-curated Setup Library with methodologies, examples, and indicator mappings
2. **Agentic Feedback** - User and admin ratings that continuously improve scan accuracy through outcome tracking

---

## Key Design Decisions

### State Management: Option C - Enhanced Modal
Rather than implementing new navigation state management, we enhance the existing `ScanChartViewer` modal which already has:
- Rating mutation (`/api/bigidea/chart-rating`)
- Chart ratings state tracking
- Session ID linkage

Enhancements needed:
- Add `trainingMode` prop
- Add Training Mode banner inside modal
- Extend rating API to accept `source_setup_id`, `training_mode` flags

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BIGIDEA AI TRAINING SYSTEM                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  SETUP LIBRARY   │    │  PROMPT ENGINE   │    │  FEEDBACK LOOP   │  │
│  │  (Static Intel)  │───▶│  (Interpretation)│◀───│ (Agentic Intel)  │  │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘  │
│           │                       │                       │             │
│           ▼                       ▼                       ▼             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        SCAN EXECUTION                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                   │                                     │
│                                   ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      OUTCOME TRACKING                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Setup Library (Admin System)

### 1.1 Purpose

Create a curated knowledge base of trading setups that the AI can reference when interpreting user prompts and selecting indicators.

### 1.2 Setup Library Data Model

```
Setup {
  id: UUID
  name: string                    // "Qullamaggie Breakout"
  slug: string                    // "qullamaggie-breakout"
  version: number                 // Increments on edit (versioning)
  status: 'draft' | 'active' | 'archived'
  
  // Content (low friction - can be minimal or extensive)
  description: text               // Methodology description
  exampleCharts: Image[]          // Uploaded chart examples
  
  // AI-Extracted (generated after save, admin-editable)
  extractedRules: JSON            // { priorMove: "30-100%", baseDuration: "3-8 weeks" }
  indicatorMapping: IndicatorConfig[]  // Suggested indicators + params
  
  // Metadata
  createdBy: adminId
  createdAt: timestamp
  updatedAt: timestamp
  previousVersionId: UUID | null  // Link to prior version for rollback
}

IndicatorConfig {
  indicatorId: string             // "PA-12"
  params: JSON                    // { minGain: 30, lookbackBars: 60 }
  required: boolean               // Must be included in scan
  weight: number                  // Importance 0-1
}
```

### 1.3 Admin Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CREATE NEW SETUP                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Name: [Qullamaggie Breakout_________________]                          │
│                                                                          │
│  Description:                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Qullamaggie's breakout setup requires a prior explosive move of    │ │
│  │ 30-100%, followed by a tight consolidation surfing the 10/20 EMA...│ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Example Charts:                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                                │
│  │  NVDA    │ │  SMCI    │ │  + Add   │                                │
│  │  📈      │ │  📈      │ │          │                                │
│  └──────────┘ └──────────┘ └──────────┘                                │
│                                                                          │
│  [Save Draft]  [Save & Extract Rules]                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.4 AI Clarifying Questions (Optional Mode)

After admin saves, AI may ask clarifying questions. **Always optional with escape hatch.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI CLARIFICATION (Optional)                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  I extracted these rules from your description. A few clarifications    │
│  would improve accuracy:                                                 │
│                                                                          │
│  • Prior advance minimum: I see "30-100%". Preferred minimum?           │
│    ( ) 25%  (•) 30%  ( ) 40%  ( ) 50%                                   │
│                                                                          │
│  • Base duration: "Several weeks" - is 3-8 weeks accurate?              │
│    (•) Yes  ( ) No, specify: [________]                                 │
│                                                                          │
│  • Volume during base: Should volume...                                 │
│    (•) Dry up (<50% of avg)  ( ) Be below average  ( ) Doesn't matter  │
│                                                                          │
│  [Apply Answers]  [Skip - Use What You Extracted]                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.5 AI Test & Admin Validation (via Training Mode)

After creating/editing a Setup, admin validates using the existing scanner infrastructure in Training Mode.

**Flow:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SETUP LIBRARY: Qullamaggie Breakout v4                                 │
│                                                                          │
│  [Edit]  [Archive]  [Validate Setup →]                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Click "Validate Setup"
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🎓 AI TRAINING MODE                          [Exit Training Mode]      │
│  Validating: Qullamaggie Breakout v4                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [Normal Scanner UI - auto-runs Setup's indicator config]               │
│                                                                          │
│  CNP   $42.65  +2.3%   [View Chart →]                                   │
│  CBOE  $198.20 +1.1%   [View Chart →]                                   │
│  ATO   $156.40 -0.5%   [View Chart →]                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Click into chart (modal opens)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  🎓 AI TRAINING MODE                          [Exit Training Mode]      │
│  Validating: Qullamaggie Breakout v4                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [ScanChartViewer Modal - Enhanced]                          [👍] [👎] │
│                                                                          │
│  👎 = removes ticker from validation list, adds negative training data  │
│  👍 = confirms good example, adds positive training data                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**

1. Admin clicks "Validate Setup" from Setup Library
2. System enters AI Training Mode:
   - Persistent banner shows active setup being validated
   - Scanner auto-runs with Setup's indicator configuration
3. Admin reviews results using normal scanner UI
4. Admin clicks into charts - **ScanChartViewer modal opens** (no page navigation)
5. Admin uses existing 👍/👎 in modal:
   - 👍 = confirms good example, adds to training data
   - 👎 = removes from result list, adds negative training data
6. All ratings automatically tagged with:
   - `rating_type: 'admin'`
   - `source_setup_id: [setup being validated]`
   - `training_mode: true`
   - `apply_flag: true`
7. Admin clicks "Exit Training Mode" when done (or clicks top menu item)

**UX Consideration:**
- Prominent banner prevents admin from forgetting they're in training mode
- Auto-expire after 30 min inactivity as safety net

**Benefits:**
- Zero new navigation/state management required
- Leverages existing `ScanChartViewer` modal with rating mutation
- Admin sees exactly what users will see
- Ratings naturally linked to indicators/thoughts via existing system

### 1.6 Setup Versioning

When admin edits an active setup:

```
Edit detected on "Qullamaggie Breakout" (v3)

Options:
  (•) Create new version (v4) - preserves history, can compare outcomes
  ( ) Update in place - overwrites v3
  ( ) Save as new setup - creates separate entry

[Save]
```

Version history enables:
- Rollback if v4 performs worse than v3
- A/B comparison of outcome data between versions
- Audit trail of changes

---

## Phase 2: Prompt Interpretation Engine

### 2.1 Two-Stage Prompt Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        STAGE 1: USER INPUT                               │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     STAGE 2: AI INTERPRETATION                           │
│                                                                          │
│  Inputs:                                                                 │
│    • User prompt                                                         │
│    • Setup Library (static knowledge)                                   │
│    • User's previous prompts/scans                                      │
│    • Agentic feedback data (what's worked before)                       │
│                                                                          │
│  Output:                                                                 │
│    • Structured interpretation for user confirmation                    │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      STAGE 3: USER CONFIRMATION                          │
│                                                                          │
│  Options:                                                                │
│    [Accept] → Proceed to scan                                           │
│    [Modify] → Iterative refinement (conversation)                       │
│    [Use Original Prompt] → Bypass interpretation                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Interpretation UI

```
┌─────────────────────────────────────────────────────────────────────────┐
│  YOUR PROMPT                                                             │
│  "Find Qullamaggie setups with tight bases in tech stocks"              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  AI INTERPRETATION                                                       │
│                                                                          │
│  Based on your prompt and the "Qullamaggie Breakout" setup:             │
│                                                                          │
│  I'll scan for:                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  ✓ Prior advance: 30%+ in past 60 days                             │ │
│  │  ✓ Base: 3-8 weeks, depth <15% (tightened per your request)        │ │
│  │  ✓ MA surfing: price within 5% of 21 EMA                           │ │
│  │  ✓ Volume: dried up during base (<50% of avg)                      │ │
│  │  ✓ Sector: Technology                                               │ │
│  │  ✓ Breakout: within 5% of pivot OR breaking out with volume        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Based on agentic feedback: Prior scans with >40% advance               │
│  performed 23% better. [Use 40%] [Keep 30%]                             │
│                                                                          │
│  [Run Scan]  [Modify]  [Use My Original Prompt]                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Iterative Refinement (Conversation Mode)

```
User: "Actually, I want even tighter bases"

AI: "Updated base depth from <15% to <10%.
     Current configuration:
     • Prior advance: 40%+
     • Base depth: <10%  ← changed
     • Base duration: 3-8 weeks
     ...
     
     Anything else?"

User: "And only stocks above $20"

AI: "Added minimum price filter: >$20
     Ready to scan?"

User: "Yes"
→ [Scan executes]
```

### 2.4 Previous Prompt Recall

```
User: "Run my tight base scan from last week but add healthcare"

AI: "Found your scan from Feb 8: 'Qullamaggie tight bases, tech'
     
     Modifications:
     • Sector: Technology → Technology + Healthcare
     
     [Run]  [Modify]  [View Original]"
```

---

## Phase 3: Scan Execution

### 3.1 How Setup Library Knowledge Is Used

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       INDICATOR SELECTION                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  LAYER 1: Setup Library Mapping                                         │
│  ─────────────────────────────────                                      │
│  Setup "Qullamaggie Breakout" requires:                                 │
│    PA-12 (Prior Price Advance)     required: true                       │
│    PA-3  (Base Detection)          required: true                       │
│    PA-16 (Volume Fade)             required: true                       │
│    MA-3  (Price vs MA Distance)    required: true                       │
│    PA-4  (Breakout Detection)      required: false                      │
│                                                                          │
│  LAYER 2: Agentic Feedback Calibration                                  │
│  ────────────────────────────────────────                               │
│  Feedback data shows:                                                   │
│    "PA-12 at 40% had 65% positive ratings vs 45% at 30%"               │
│                                                                          │
│  Applied adjustment:                                                    │
│    PA-12: minGain = 30% → 40% (based on agentic feedback)              │
│                                                                          │
│  LAYER 3: User Modifications                                            │
│  ──────────────────────────────                                         │
│  User requested "tight bases":                                          │
│    PA-3: maxRange = 25% → 10%                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Confidence Scores

Each scan result includes match quality:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CNP - 87% match                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ✓ Prior advance: 45% (threshold: ≥40%)           STRONG                │
│  ✓ Base depth: 8.9% (threshold: <10%)             STRONG                │
│  ✓ Base duration: 18 days (threshold: 15-40)      PASS                  │
│  ⚠ Volume fade: 0.62 (threshold: <0.5)            BORDERLINE            │
│  ✓ Price vs 21 EMA: 2.1% (threshold: <5%)         STRONG                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Feedback System (Agentic Intelligence)

### 4.1 Rating Mechanism

**Use existing thumbs up/down in ScanChartViewer modal.** Admin and users evaluate tickers by viewing charts.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ScanChartViewer Modal                                                   │
│  CHART: CNP                                                    [👍] [👎]│
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [Chart visualization]                                                  │
│                                                                          │
│  Source: Scan "Qullamaggie Breakout" (Feb 15, 2026)                    │
│  Match: 87% │ Prior: +45% │ Base: 8.9% │ Duration: 18d                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Rating Data Model

**Extend existing chart-rating API with type flags:**

```sql
-- Extend existing bigidea_chart_rating table (or ticker_ratings)
chart_rating (
  id: UUID,
  ticker: string,
  rating: 'up' | 'down' | 'neutral',
  
  -- Type flags
  rating_type: 'user' | 'admin' | 'system',
  apply_flag: boolean,            -- Admin: true by default
                                  -- User: false until approved
  training_mode: boolean,         -- Was this from Setup validation?
  
  -- Context (what generated this rating)
  source_type: 'scan' | 'chart_standalone' | 'chart_ivyai' | 
               'scan_chart' | 'scan_chart_ivyai' | 'direct_entry',
  source_scan_id: UUID | null,
  source_idea_id: UUID | null,
  source_setup_id: UUID | null,
  source_setup_version: number,
  
  -- Snapshot at time of rating
  indicator_snapshot: JSON,       -- { "PA-12": 45, "PA-3": 8.9, ... }
  price_at_rating: decimal,
  
  -- Metadata
  user_id: UUID,
  session_id: number,
  note: text | null,
  created_at: timestamp,
  updated_at: timestamp
)
```

### 4.3 Admin vs User Ratings

| Rating Source | `rating_type` | `apply_flag` | Effect |
|---------------|---------------|--------------|--------|
| Admin rates ticker | `admin` | `true` | Immediately influences agentic feedback |
| User rates ticker | `user` | `false` | Stored but not applied |
| Admin approves user rating | `user` | `true` → set | Now influences feedback |
| System (outcome tracking) | `system` | `true` | Auto-applied based on results |

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ADMIN: PENDING USER RATINGS                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User @trader123 rated:                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  CNP  👍  "Clean breakout, textbook setup"    [Apply] [Reject]     │ │
│  │  ATO  👎  "Extended, no base"                 [Apply] [Reject]     │ │
│  │  CBOE 👍  (no note)                           [Apply] [Reject]     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  [Apply All]  [Reject All]                                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 5: Outcome Tracking

### 5.1 Tracking Cadence

| Interval | Measurement | Purpose |
|----------|-------------|---------|
| T+1 day | Gap up? Breakout? | Immediate signal |
| T+5 days | Early momentum, stop triggered? | Short-term validation |
| T+20 days | Hit 10-20% target? | Swing trade outcome |
| T+60 days | Full move captured? | Position trade outcome |

### 5.2 What Gets Tracked

**Priority order:**

1. **Admin-rated tickers** (explicit high-value signal)
2. **User-rated tickers with `apply_flag = true`**
3. **Tickers user clicked into** (implicit interest)
4. **All scan results** (background bulk data)

### 5.3 Outcome Data Model

```sql
outcome_tracking (
  id: UUID,
  
  -- Source
  ticker: string,
  source_scan_id: UUID,
  source_setup_id: UUID,
  source_setup_version: number,
  
  -- Entry point
  entry_date: date,
  entry_price: decimal,
  
  -- Snapshots at intervals
  price_1d: decimal,
  price_5d: decimal,
  price_20d: decimal,
  price_60d: decimal,
  
  -- Calculated metrics
  gain_1d: decimal,
  gain_5d: decimal,
  gain_20d: decimal,
  gain_60d: decimal,
  
  max_gain_5d: decimal,
  max_gain_20d: decimal,
  max_gain_60d: decimal,
  
  max_drawdown_5d: decimal,
  max_drawdown_20d: decimal,
  max_drawdown_60d: decimal,
  
  -- Binary outcomes
  hit_10pct: boolean,
  hit_20pct: boolean,
  stopped_out_8pct: boolean,
  
  -- Link to ratings
  admin_rating: 'up' | 'down' | null,
  user_rating: 'up' | 'down' | null,
  
  -- Metadata
  created_at: timestamp,
  updated_at: timestamp
)
```

### 5.4 Feedback Loop Processing

Weekly job correlates outcomes with indicator configs:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENTIC FEEDBACK ANALYSIS                                               │
│  Week of Feb 15, 2026                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SETUP: Qullamaggie Breakout (v4)                                       │
│  Sample: 847 tickers tracked                                            │
│                                                                          │
│  FINDING 1: Prior Advance Threshold                                     │
│  ─────────────────────────────────────                                  │
│  PA-12 ≥ 50%:  68% hit +10% within 20d  │  avg gain: 18%               │
│  PA-12 ≥ 40%:  54% hit +10% within 20d  │  avg gain: 14%               │
│  PA-12 ≥ 30%:  42% hit +10% within 20d  │  avg gain: 11%               │
│                                                                          │
│  RECOMMENDATION: Increase PA-12 default from 30% to 50%                 │
│  [Apply to Setup v5]  [Ignore]                                          │
│                                                                          │
│  FINDING 2: Volume Fade Correlation                                     │
│  ──────────────────────────────────────                                 │
│  PA-16 < 0.5:  71% success rate                                         │
│  PA-16 < 0.7:  58% success rate                                         │
│  PA-16 < 0.9:  44% success rate                                         │
│                                                                          │
│  RECOMMENDATION: Tighten PA-16 threshold from 0.7 to 0.5                │
│  [Apply to Setup v5]  [Ignore]                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 6: Watchlist Enhancement

### 6.1 Source Tracking

Track how each watchlist item was added:

```sql
-- Extend existing watchlist_item table
watchlist_item (
  id: UUID,
  watchlist_id: UUID,
  ticker: string,
  
  -- Source tracking
  source_type: enum(
    'chart_standalone',        -- Added from standalone chart
    'chart_ivyai',             -- Added from standalone chart via IvyAI overlay
    'scan_chart',              -- Added from scan result chart
    'scan_chart_ivyai',        -- Added from scan chart via IvyAI overlay
    'direct_entry'             -- User typed ticker directly (future)
  ),
  
  source_scan_id: UUID | null,
  source_idea_id: UUID | null,
  source_setup_id: UUID | null,
  
  added_at: timestamp,
  added_by: UUID
)
```

### 6.2 Watchlist Categorization by Scan Type

```sql
-- Extend existing watchlist table
watchlist (
  id: UUID,
  name: string,
  user_id: UUID,
  
  -- Categorization
  setup_category_id: UUID | null,  -- Link to Setup Library entry
  idea_id: UUID | null,            -- Link to originating Idea
  auto_categorized: boolean,       -- System inferred vs user set
  
  created_at: timestamp,
  updated_at: timestamp
)
```

### 6.3 Watchlist UI Enhancement

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MY WATCHLISTS                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  📁 Qullamaggie Breakouts (12 tickers)                                  │
│     Setup: Qullamaggie Breakout v4                                      │
│     Sources: 8 from scan, 3 from chart, 1 direct                        │
│                                                                          │
│  📁 VCP Setups (7 tickers)                                              │
│     Setup: Minervini VCP v2                                             │
│     Sources: 5 from scan, 2 from IvyAI                                  │
│                                                                          │
│  📁 Manual Picks (4 tickers)                                            │
│     Setup: None (uncategorized)                                         │
│     Sources: 4 direct entry                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] Setup Library CRUD (admin)
- [ ] Basic AI extraction (no clarifying questions)
- [ ] Prompt restatement + confirmation flow
- [ ] Extend rating table with `rating_type`, `apply_flag`, `source_type`
- [ ] Training Mode banner in ScanChartViewer modal

### Phase 2: Intelligence
- [ ] AI clarifying questions (optional mode)
- [ ] Training Mode validation using existing scanner + modal
- [ ] Agentic feedback surfacing in prompt interpretation
- [ ] Confidence scores on scan results

### Phase 3: Learning Loop
- [ ] Outcome tracking pipeline (T+1/5/20/60)
- [ ] Feedback correlation analysis
- [ ] Setup versioning with comparison
- [ ] Automated parameter recommendations

### Phase 4: Polish
- [ ] Watchlist source tracking
- [ ] Watchlist categorization by setup
- [ ] Iterative prompt refinement (conversation mode)
- [ ] Previous prompt recall
- [ ] Admin approval queue for user ratings

---

## Appendix A: Source Type Definitions

| Source Type | Description | Context Captured |
|-------------|-------------|------------------|
| `chart_standalone` | User viewed ticker chart directly (not from scan) | Ticker, timestamp |
| `chart_ivyai` | User used IvyAI overlay on standalone chart | Ticker, IvyAI context |
| `scan_chart` | User clicked into chart from scan results | Scan ID, Idea ID, Setup ID |
| `scan_chart_ivyai` | User used IvyAI on chart accessed from scan | Scan ID, Idea ID, Setup ID, IvyAI context |
| `direct_entry` | User typed ticker manually (future feature) | Ticker only |

---

## Appendix B: Agentic Feedback Metrics

Metrics derived from outcome tracking:

| Metric | Calculation | Use |
|--------|-------------|-----|
| Win Rate | % of tickers hitting +10% within 20d | Setup quality |
| Avg Gain | Mean gain at 20d for setup | Parameter tuning |
| Max DD | Mean max drawdown within 20d | Risk assessment |
| Sharpe-like | Avg Gain / Std Dev of gains | Risk-adjusted quality |
| Admin Correlation | Correlation between admin 👍 and eventual success | Validate admin judgment |
| User Correlation | Correlation between user 👍 and eventual success | Decide whether to auto-apply user ratings |

---

## Appendix C: Existing Infrastructure Leveraged

### ScanChartViewer Modal (BigIdeaPage.tsx)
- Already has rating mutation at line 4508-4537
- Already tracks `chartRatings` state
- Already linked to `sessionId`
- **Enhancement needed**: Add `trainingMode`, `sourceSetupId` props and pass to API

### Rating API (/api/bigidea/chart-rating)
- Already exists
- **Enhancement needed**: Accept additional fields (`rating_type`, `training_mode`, `source_setup_id`, etc.)

---

*End of Specification v1.1*
