# Stock-Pattern-Stream System Architecture

This document contains critical system knowledge for AI assistants and developers. **Update this file whenever making architectural changes.**

---

## Big Idea Scanner - Complete Architecture

### Conceptual Model

The Big Idea Scanner is an AI-powered stock screening system built on three hierarchical concepts:

**1. Ideas (Top Level)**
- A complete screening strategy combining multiple Thoughts
- Represented as a React Flow graph with nodes (thoughts) and edges (logic connections)
- Stored in `scanner_ideas` table with `nodes` (IdeaNode[]) and `edges` (IdeaEdge[])
- Can be saved, loaded, and shared between users
- Each Idea targets a specific stock **Universe** (S&P 500, Nasdaq 100, Dow 30, Russell 2000, Watchlist)

**2. Thoughts (Mid Level)**
- A named, reusable collection of screening criteria
- Stored in `scanner_thoughts` table with name, category, description, criteria array
- Categories: `Momentum`, `Value`, `Trend`, `Volatility`, `Volume`, `Consolidation`, `Custom`
- Each Thought has a **score** (integer) that increases/decreases based on user feedback
- Has a `timeframe` property: `daily`, `5min`, `15min`, `30min`

**3. Indicators/Criteria (Base Level)**
- Individual technical or price-action conditions
- Defined in `server/bigidea/indicators.ts` as `INDICATOR_LIBRARY` array
- Each criterion has: `indicatorId`, `label`, `inverted`, `muted`, `timeframeOverride`, `params[]`
- Parameters have `name`, `label`, `type`, `value`, with optional `min`/`max`/`step` bounds

### Data Structures

```typescript
// IdeaNode - Visual representation of a thought in the flow editor
interface IdeaNode {
  id: string;
  type: "thought" | "results";
  thoughtId?: number;           // Reference to saved thought
  thoughtName?: string;
  thoughtCategory?: string;
  thoughtCriteria?: ScannerCriterion[];  // The actual filter logic
  thoughtTimeframe?: string;
  isNot?: boolean;              // Invert entire thought (find stocks that DON'T match)
  isMuted?: boolean;            // Exclude from scan but keep in graph
  position: { x: number; y: number };
  passCount?: number;           // Stocks passing this filter (after scan)
}

// IdeaEdge - Logic connection between nodes
interface IdeaEdge {
  id: string;
  source: string;               // Source node ID
  target: string;               // Target node ID
  logicType: "AND" | "OR";      // How to combine results
}

// ScannerCriterion - Individual filter condition
interface ScannerCriterion {
  indicatorId: string;          // e.g., "MA-1", "PA-3", "VOL-5"
  label: string;
  inverted: boolean;            // Find stocks that FAIL this criterion
  muted?: boolean;
  timeframeOverride?: string;   // Force daily even when thought is intraday
  params: ScannerCriterionParam[];
}
```

### AI-Powered Thought Generation

**Endpoint**: `POST /api/bigidea/ai/create-thought`

**Flow**:
1. User enters natural language description (e.g., "stocks breaking out of a tight base with volume")
2. Server sends description + full indicator library to OpenAI (gpt-4o)
3. AI maps concepts to specific indicators with appropriate parameters
4. Returns one or more thoughts with edges (for data-linked indicators)

**Key System Prompt Rules**:
- AI must use indicator library exactly (no invented indicators)
- Consumer indicators (PA-12 to PA-16) MUST be in separate thought from providers (PA-3, PA-7)
- Names/descriptions must accurately reflect what criteria detect (no overselling)
- Parameters default to permissive values (avoid 0-result scans)
- Can specify `timeframeOverride: "daily"` for daily-level indicators

### Data-Linking Between Thoughts

Some indicators **provide** data that downstream indicators **consume**. Data flows through edges.

**Provider Indicators** (output `detectedPeriod` or base data):
- `PA-3` (Consolidation/Base Detection) → outputs `detectedPeriod`
- `PA-7` (Breakout Detection) → outputs `detectedPeriod`
- `CB-1` (Find Base) → outputs `baseStartBar`, `baseEndBar`, `baseTopPrice`, `baseLowPrice`

**Consumer Indicators** (require upstream provider):
- `PA-12` (Prior Price Advance) → consumes `detectedPeriod` or `baseStartBar`
- `PA-13` (Smooth Trending Advance) → consumes `detectedPeriod` or `baseStartBar`
- `PA-14` (Tightness Ratio) → consumes `detectedPeriod` as `baselineBars`
- `PA-15` (Close Clustering) → consumes `detectedPeriod` as `period`
- `PA-16` (Volume Fade) → consumes `detectedPeriod` as `baselineBars`

**CRITICAL RULE**: Provider and consumer CANNOT be in same thought. Must split:
```
Thought A (provider) → Edge → Thought B (consumers)
```

**Auto-Linking**: When a param has `autoLinked: true`, the value comes from upstream thought's output rather than a static number.

### Scan Execution Flow

**Endpoint**: `POST /api/bigidea/scan`

**Process**:
1. Fetch all tickers for selected universe
2. For each thought (topologically sorted by edges):
   a. Fetch OHLCV data for each ticker (Tiingo API)
   b. Evaluate all non-muted criteria
   c. Apply `inverted` logic (flip pass/fail)
   d. Apply `isNot` logic (invert entire thought result)
   e. Store passing symbols and output data (for data-linking)
3. Apply edge logic (AND = intersection, OR = union) between thoughts
4. Results node receives final filtered list
5. Score thoughts if scan returned results

**Caching**: OHLCV data cached in `ohlcvCache` Map (5 min for intraday, longer for daily)

### Query Optimizer (Adaptive Learning System) 🆕

The scan engine includes an **intelligent query optimizer** that automatically reorders thoughts to minimize execution time and API calls. Inspired by database query planners, it learns from every scan and continuously improves.

**How It Works**:

1. **Pattern Detection**: Before scan execution, checks if thoughts are connected in a "parallel to results" pattern:
   ```
   [Thought A] ↘
   [Thought B] → [Results]  ← DETECTED: All thoughts evaluate full universe
   [Thought C] ↗
   ```

2. **Cost Estimation**: For each thought, estimates:
   - **Execution Time**: How long the indicators take to run (ms per evaluation)
   - **Selectivity**: How many stocks pass (higher selectivity = filters out more = cheaper downstream)
   - **Confidence**: Based on amount of historical data (0-1 scale)

3. **Optimization Algorithm** (Greedy):
   - At each step, pick thought with **lowest effective cost**
   - Effective cost = (execution time × stocks remaining) - (benefit from filtering)
   - Example order: `[FND-3 Sector] → [FND-1 Market Cap] → [ITD-3 Gap] → [MOM-3 MACD]`

4. **Learning Over Time**:
   - **Scan 1**: Uses static cost heuristics (FND=fast, MACD=slow)
   - **Scan 50**: Learns actual performance (FND-1: 5.2ms avg, 15% pass rate, selectivity 0.85)
   - **Scan 200**: Adapts to market regime (Gap detection: 8% pass in choppy, 15% pass in bull)
   - **Scan 500**: Discovers universe patterns (FND-3 Tech: 22% pass in NASDAQ, 15% pass in S&P 500)

**Performance Tracking** (`indicator_execution_stats` table):
```typescript
{
  indicatorId: "FND-1",
  avgExecutionTimeMs: 5.2,       // Exponential moving average
  avgPassRate: 0.15,             // How often stocks pass
  selectivityScore: 0.85,        // 1 - passRate (higher = run earlier)
  totalEvaluations: 25,042,      // Cumulative learning data
  universeStats: {
    "sp500": { passRate: 0.15, avgTimeMs: 5.1 },
    "nasdaq100": { passRate: 0.22, avgTimeMs: 5.4 }
  },
  regimeStats: {
    "Bull/RISK-ON": { passRate: 0.18 },
    "Neutral/CHOPPY": { passRate: 0.12 }
  },
  timeframeStats: {
    "daily": { passRate: 0.15, avgTimeMs: 5.0 },
    "5min": { passRate: 0.14, avgTimeMs: 12.3 }
  }
}
```

**Typical Improvements**:
- Parallel scans → **50-75% reduction** in total evaluations
- Fundamental filters (FND-*) automatically moved to start (fast + selective)
- Complex momentum indicators (MOM-*, VLT-4) moved to end (expensive, run on fewer stocks)

**Static Cost Heuristics** (used before sufficient data collected):
- **Fundamental (FND-*)**: 2ms, selectivity 0.6-0.8 (DB lookup, highly selective)
- **Price Action (PA-*)**: 5ms, selectivity 0.3-0.4 (fast math)
- **Momentum (MOM-*)**: 25-35ms, selectivity 0.2-0.3 (complex calculations)
- **Consolidation (CB-1)**: 40ms, selectivity 0.15 (pattern detection, expensive)

**Implementation**:
- **File**: `server/bigidea/queryOptimizer.ts` (500+ lines)
- **Detection**: `shouldAutoOptimize(thoughts, edges)` checks for parallel pattern
- **Optimization**: `autoOptimizeThoughtOrder(thoughts, edges, context)` reorders thoughts
- **Learning**: `recordThoughtPerformance(indicatorId, performance)` updates stats after each scan (async, non-blocking)
- **Context-Aware**: Uses market regime, universe, and timeframe to adjust cost estimates

**Console Output Example**:
```
[BigIdea Scan] Initial evaluation order: "Tech Stocks" → "Gap Up" → "MACD" → "Earnings"
[QueryOptimizer] Cost estimates:
  Tech Stocks: 2.1ms, selectivity: 78.0%, confidence: 85%
  Gap Up: 5.0ms, selectivity: 30.0%, confidence: 65%
  MACD: 35.2ms, selectivity: 30.0%, confidence: 90%
  Earnings: 2.0ms, selectivity: 50.0%, confidence: 75%
[QueryOptimizer] Reordered 4 thoughts: Tech Stocks → Earnings → Gap Up → MACD
[BigIdea Scan] ✨ AUTO-OPTIMIZED evaluation order: "Tech Stocks" → "Earnings" → "Gap Up" → "MACD"
```

**Optimizer Metrics Display** 🆕:

The query optimizer's learning progress is displayed directly on the Big Idea Scanner canvas, providing visual feedback and building user trust.

- **Display Component**: `OptimizerMetricsOverlay.tsx` - React component overlaying the ReactFlow canvas
- **Three Display Modes**:
  - **Minimal**: Single line (`🧠 Optimizer: +21.02% | 247 scans · 85% confidence`)
  - **Compact**: 3-4 lines with key metrics (efficiency, weekly improvement, confidence with progress bar)
  - **Detailed**: Full stats card with all metrics, achievement badges, and admin debug info
- **Theme Options**: Matrix (green glow), Cyberpunk (cyan glow), Minimal (gray, clean)
- **Positioning**: Flexible (bottom-center, bottom-right, bottom-left, top-right, top-left)
- **Metrics Shown**:
  - **Overall Improvement %**: Since inception (e.g., `+21.023%`)
  - **Weekly Improvement %**: Last 7 days vs previous 7 days (e.g., `+0.03%`)
  - **Confidence Level**: 0-100% based on learning data volume (Very High/High/Medium/Low/Building...)
  - **Scan Statistics**: Total scans analyzed and evaluations tracked
  - **Achievement Badges**: Unlock milestones (e.g., 🏆 100+ Scans Milestone)
  - **Debug Info** (Admin Only): Top performer indicator, selectivity scores

**Admin Control Panel**:

New "Query Optimizer" tab in `SentinelAdminPage` provides full control over the metrics display:

- **Master Toggle**: Show/hide the entire overlay globally
- **Per-Metric Toggles**: Enable/disable individual stats (overall improvement, weekly improvement, confidence, scan stats, live optimization, achievement badges)
- **Admin Override Mode**: Different settings for admin view vs regular users
  - Admin can see all metrics + debug info
  - Regular users see simplified version
- **Display Preferences**: Position (bottom-center default to avoid conflicts with React Flow minimap), style (minimal/compact/detailed), theme (matrix/cyberpunk/minimal)
- **Performance Dashboard**: Real-time stats with 30-second auto-refresh
- **Indicator Performance Table**: Sortable table of all 54 indicators with pass rate, selectivity, avg execution time, evaluations, and confidence

**API Endpoints**:
- `GET /api/bigidea/optimizer-stats`: Returns aggregated performance metrics
- `GET /api/bigidea/optimizer-display-settings`: Returns display settings (respects admin override)
- `PATCH /api/admin/optimizer-display-settings`: Updates settings (admin only)

**Database Table**: `optimizer_display_settings` (20 columns) stores all display preferences and admin overrides.

**User Experience Goal**: Visible AI learning creates the "Wow, this thing is high-tech!" moment, building trust through transparency while giving admins full control over what users see.

### Indicator Library (54 Indicators)

**Moving Averages (MA-1 to MA-9)**:
- `MA-1`: SMA Value (price vs SMA)
- `MA-2`: EMA Value (price vs EMA)
- `MA-3`: Price vs MA Distance (% proximity)
- `MA-4`: MA Slope (trend direction)
- `MA-5`: MA Stacking Order (3 MAs aligned)
- `MA-6`: MA Distance/Convergence
- `MA-7`: MA Crossover (golden/death cross)
- `MA-8`: MA Comparison (fast above/below slow)
- `MA-9`: Price Crosses MA

**Volume (VOL-1 to VOL-5)**:
- `VOL-1`: Volume vs Average
- `VOL-2`: Volume Trend (increasing/decreasing)
- `VOL-3`: Up/Down Volume Ratio
- `VOL-4`: Volume Dry-Up
- `VOL-5`: Volume Surge

**Price Action (PA-1 to PA-17)**:
- `PA-1`: ATR (absolute)
- `PA-2`: ATR Percent
- `PA-3`: Consolidation/Base Detection ⭐ (PROVIDER)
- `PA-4`: Base Depth
- `PA-5`: Base Count
- `PA-6`: Distance from 52-Week High
- `PA-7`: Breakout Detection ⭐ (PROVIDER)
- `PA-8`: Pullback to Level
- `PA-9`: VCP Tightness
- `PA-10`: Price Gap Detection
- `PA-11`: Distance from Key Level (VWAP/Pivot)
- `PA-12`: Prior Price Advance ⭐ (CONSUMER)
- `PA-13`: Smooth Trending Advance ⭐ (CONSUMER)
- `PA-14`: Tightness Ratio ⭐ (CONSUMER)
- `PA-15`: Close Clustering ⭐ (CONSUMER)
- `PA-16`: Volume Fade ⭐ (CONSUMER)
- `PA-17`: Wedge Pop Detection (Oliver Kell pattern)

**Relative Strength (RS-1 to RS-7)**:
- `RS-1`: RS vs Index (outperformance %)
- `RS-2`: RS Score (ratio)
- `RS-3`: RS Line New High
- `RS-4`: RSI (classic RSI oscillator)
- `RS-5`: MACD (crossover/histogram/zero line)
- `RS-6`: ADX (trend strength)
- `RS-7`: Bull/Bear Power (Elder)

**Volatility (VLT-1 to VLT-5)**:
- `VLT-1`: Bollinger Band Width
- `VLT-2`: ATR Contraction/Expansion
- `VLT-3`: Daily Range vs Average
- `VLT-4`: Squeeze Detection (TTM)
- `VLT-5`: Price vs Bollinger Bands (%B position) 🆕

**Consolidation (CB-1)**:
- `CB-1`: Find Base ⭐ (PROVIDER) - scans history for base formations

**Momentum (MOM-1 to MOM-3)** 🆕:
- `MOM-1`: Stochastic Oscillator (%K/%D crossovers, overbought/oversold)
- `MOM-2`: RSI Divergence (bullish/bearish divergence detection)
- `MOM-3`: MACD Histogram (histogram direction, zero-cross)

**Fundamental (FND-1 to FND-4)** 🆕:
- `FND-1`: Market Cap Filter (micro to mega-cap)
- `FND-2`: PE Ratio Filter (value/growth screening)
- `FND-3`: Sector Filter (include/exclude sectors)
- `FND-4`: Earnings Proximity (days to earnings)
- *Note*: Fundamental indicators require `upstreamData.fundamentalData` from scan engine

**Intraday (ITD-1 to ITD-3)** 🆕:
- `ITD-1`: Opening Range Breakout (ORB with volume confirmation)
- `ITD-2`: VWAP Position (above/below/cross VWAP)
- `ITD-3`: Gap Detection (gap up/down with fill status)

### Scoring System

**Three-Level Scoring**:

1. **Thought Scores** (`scanner_thoughts.score`)
   - Rules in `thought_score_rules` table
   - Events:
     - `idea_save_modified`: +3 when thought modified before save
     - `scan_returned_data`: +1 when scan finds results
     - `chart_thumbs_up`: +1 for positive chart rating
     - `chart_thumbs_down`: -2 for negative chart rating
   - Higher score = more trusted/used thought

2. **Idea Quality Score** (`server/bigidea/quality.ts`)
   - Evaluated via `evaluateScanQuality(nodes, edges)`
   - **5 Dimensions** (100 points max):
     - **Criteria Diversity** (25 pts): Categories used, unique indicators
     - **Filter Funnel** (20 pts): Thought count, AND/OR edges, narrowing pattern
     - **Data Linking** (20 pts): Proper provider→consumer wiring
     - **Parameter Quality** (15 pts): Values within bounds, no conflicts
     - **Signal Coverage** (20 pts): Trend + Volume + Price Action + RS pillars
   - Grades: A (90+), B (75-89), C (60-74), D (40-59), F (<40)

3. **Chart Ratings** (`scan_chart_ratings` table)
   - User thumbs-up/down on individual scan results
   - Feeds back into thought scoring
   - Stored with: `symbol`, `rating`, `ideaId`, `sessionId`, `indicatorSnapshot`, `price`

### AI Tuning System

**Endpoint**: `POST /api/bigidea/scan-tune`

**Purpose**: AI analyzes scan results and suggests parameter adjustments

**Input**:
- Current nodes/edges configuration
- Funnel data (pass counts per thought)
- Result count
- User chart ratings (thumbs up/down)
- Optional user instruction

**AI Suggestions**:
- Loosen restrictive parameters (if too few results)
- Tighten parameters (if results are low quality per ratings)
- Add/remove criteria
- Adjust based on historical learning data

**Historical Learning**:
- `indicator_learning_summary` table tracks:
  - Total accepted/discarded tuning suggestions per indicator
  - Average accepted param values
  - Performance by market regime, universe, archetype
- Used to guide future AI suggestions

### Universes

**Available Stock Lists** (`server/bigidea/universes.ts`):
- `dow30`: 30 Dow Jones Industrial Average stocks
- `nasdaq100`: 100 Nasdaq-100 index stocks
- `sp500`: 500+ S&P 500 index stocks
- `russell2000`: 2000 Russell 2000 small-cap stocks
- `watchlist`: User's personal watchlist (from `sentinel_watchlist`)

### Frontend Flow Editor

**Library**: React Flow (@xyflow/react)

**Node Types**:
- `thought`: Displays thought name, criteria count, category icon
- `results`: Shows final filtered symbols list

**Interactions**:
- Drag nodes from left panel to canvas
- Connect nodes via handles to create edges
- Click edge to toggle AND/OR logic
- Click node to expand/edit criteria
- Right-click for context menu (mute, NOT, delete)

**Result Panel** (right side):
- Lists passing symbols
- Click symbol → opens `ScanChartViewer` modal
- Thumbs up/down buttons for rating
- Star button to favorite

---

## User Tiers & Learning System

### Three-Tier User Model

| Tier | `sentinel_users.tier` | Description |
|------|----------------------|-------------|
| **Standard** | `"standard"` | Basic access, no AI tuning |
| **Pro** | `"pro"` | Full features, tuning needs admin approval |
| **Admin** | `"admin"` | Full access, auto-approved contributions |

**Note**: `isAdmin` boolean field can override tier (legacy support)

### Tier Access Matrix

| Feature | Standard | Pro | Admin |
|---------|----------|-----|-------|
| View/Run Scans | ✅ | ✅ | ✅ |
| Save Ideas/Thoughts | ✅ | ✅ | ✅ |
| Rate Charts (thumbs) | ✅ | ✅ | ✅ |
| AI Tuning | ❌ | ✅ | ✅ |
| View Pending Reviews | ❌ | ❌ | ✅ |
| Approve/Reject Tuning | ❌ | ❌ | ✅ |
| Modify Score Rules | ❌ | ❌ | ✅ |
| Modify Selection Weights | ❌ | ❌ | ✅ |

### Learning System Flow

**Purpose**: Track which tuning adjustments improve scan quality over time

**Key Table**: `indicator_learning_summary`
- Aggregates: total accepted/discarded, param stats, retention rates
- Segmented by: market regime, universe, archetype

**adminApproved Flag** (on `scan_tuning_history`):

| User Tier | Value on Submit | Effect |
|-----------|-----------------|--------|
| Admin | `true` | Immediately updates learning summary |
| Pro | `null` | Pending admin review |
| Standard | N/A | Cannot access tuning |

**Learning Update Gate**:
```typescript
if (outcome === "accepted" && adminApproved === true) {
  await upsertIndicatorLearningSummary(record);
}
```

Only admin-approved sessions contribute to the learning corpus.

### Admin Review Workflow

1. **Pro user** accepts AI tuning suggestions → `adminApproved = null`
2. **Admin** views pending: `GET /api/bigidea/scan-tune/pending-reviews`
3. **Admin** approves/rejects: `PATCH /api/bigidea/scan-tune/:id/approve`
   - `approved: true` → triggers learning summary update
   - `approved: false` → excluded from future AI context

### AI Context Selection

When building tuning prompts, historical data is filtered:
```typescript
sql`${scanTuningHistory.adminApproved} IS NOT FALSE`
```

- ✅ Includes: `adminApproved = true` (approved)
- ✅ Includes: `adminApproved = null` (pending — for visibility)
- ❌ Excludes: `adminApproved = false` (rejected)

This ensures rejected tuning patterns don't pollute future AI suggestions.

---

## Data Providers & API Keys

### **Dual Data Provider Strategy** (Updated 2026-02-16)

The app now uses **two market data providers** for optimal coverage:

### **1. Alpaca** (Intraday Data with Extended Hours)
- **Purpose**: Intraday OHLCV data (5m, 15m, 30m) with **extended trading hours support**
- **Environment Variables**: 
  - `ALPACA_API_KEY` ✅
  - `ALPACA_API_SECRET` ✅
  - `ALPACA_BASE_URL` (paper trading URL) ✅
- **Usage**:
  - Chart data endpoint (`/api/sentinel/chart-data`) for **intraday timeframes only**
  - Supports pre-market (4:00-9:30 AM ET) and after-hours (4:00-8:00 PM ET)
  - Uses Alpaca Market Data API v2 with **SIP feed** (100% market coverage)
- **Implementation**: `server/alpaca.ts`, routing logic in `server/sentinel/chartDataEngine.ts`
- **Caching**: No backend cache - always fetches fresh data
- **Status**: ✅ **ACTIVE** - Fully configured and operational
- **ETH Support**: ✅ **Working** - When ETH toggle is ON, includes pre/after-hours candles
- **Subscription**: Algo Trader Plus ($99/mo)
  - 10,000 API calls/min
  - SIP feed (100% market coverage - all US exchanges)
  - Real-time data + 7+ years historical
  - Extended hours included

### **2. Tiingo** (Daily/EOD Data)
- **Purpose**: Daily OHLCV data, real-time quotes, ticker metadata
- **Environment Variable**: `TIINGO_API_KEY`
- **Usage**:
  - Chart data endpoint (`/api/sentinel/chart-data`) for **daily timeframe only**
  - Trade chart metrics endpoint (`/api/sentinel/trade-chart-metrics`)
  - Big Idea Scanner (fetches EOD prices, historical bars)
  - IEX endpoint: Regular trading hours only (9:30 AM - 4:00 PM ET)
- **Implementation**: `server/tiingo.ts`
- **Caching**: No backend cache - always fetches fresh data
- **Status**: ✅ Currently working
- **ETH Support**: ❌ **Not Available** - Tiingo IEX endpoint does not support extended hours

### **3. Finnhub** (Primary Fundamental Data - FREE)
- **Purpose**: Company fundamentals, financial ratios, earnings, analyst ratings, price targets
- **Environment Variables**: 
  - `FINNHUB_API_KEY` ✅
  - `FINNHUB_SECRET` ✅
- **Usage**:
  - `getExtendedFundamentals()` in `server/fundamentals.ts`
  - `getFundamentals()` for basic sector/industry/market cap
- **Available Data** (60+ metrics):
  - Company profile: name, market cap, industry, exchange
  - Financial ratios: PE, beta, debt/equity, ROA, current ratio, quick ratio
  - Growth metrics: EPS growth (3Y), revenue growth (TTM YoY), revenue growth (3Y)
  - Analyst data: Buy/Hold/Sell consensus, price targets (mean/median)
  - Earnings: Next earnings date, EPS surprises, actual vs estimate
  - Valuation: PE, PB, PS ratios, dividend yield
- **Implementation**: `server/finnhub.ts`, `server/fundamentals.ts`
- **Caching Strategy**:
  - **Database-Backed Cache**: PostgreSQL `fundamentals_cache` table (24hr TTL)
  - **Persistence**: Survives server restarts (DB-backed, not in-memory)
  - **Columns**: sector, industry, marketCap, companyName, exchange, pe, beta, debtToEquity, preTaxMargin, analystConsensus, targetPrice, nextEarningsDate, nextEarningsDays, epsCurrentQYoY, salesGrowth3QYoY, lastEpsSurprise, fetchedAt
  - **Behavior**: First request fetches from Finnhub and saves to DB, subsequent requests (within 24h) served instantly from DB
- **Status**: ✅ **ALL FUNDAMENTAL FIELDS OPERATIONAL**
- **Rate Limit**: 60 API calls/min (FREE tier)
- **Cost**: $0/month

### **4. FMP (Financial Modeling Prep)** (Legacy - Peers Only)
- **Purpose**: Industry peer company lookups
- **Environment Variable**: `FMP_API_KEY`
- **Usage**: `fetchIndustryPeersFromFMP()` for peer ticker lists
- **Caching Strategy**: 12hr in-memory cache (`fmpPeersCache` Map)
- **Status**: ✅ Working for peers endpoint only (all other fundamental data moved to Finnhub)

### **OpenAI** (AI Features)
- **Purpose**: Trade evaluation, Big Idea Scanner tuning, pattern analysis
- **Environment Variable**: `OPENAI_API_KEY`
- **Models Used**:
  - `gpt-5.1`: Standard trade evaluation
  - `gpt-5.2`: Deep evaluation mode
  - `gpt-4o`: Big Idea Scanner generation and tuning
- **Usage**:
  - `/api/sentinel/evaluate` (Trade Evaluator)
  - `/api/bigidea/scan` (Pattern scanning)
  - `/api/bigidea/tune` (AI-driven parameter tuning)

### **DeepSeek** (Optional Alternative AI)
- **Environment Variable**: `DEEPSEEK_API_KEY`
- **Status**: Configured but not actively used

---

## Database & Session Management

### **PostgreSQL (Neon)**
- **Environment Variable**: `DATABASE_URL`
- **ORM**: Drizzle
- **Tables**:
  - `sentinel_users`: User accounts
  - `sentinel_trades`: Trade history
  - `sentinel_watchlist`: Tracked symbols
  - `sentinel_rules`: Trading rules
  - `bigidea_*`: Scanner thoughts, sessions, ratings
  - `pattern_training_*`: (Archived, tables preserved)
- **Session Storage**: `express-session` with `connect-pg-simple` (PostgreSQL store)
- **Local Dev Fallback**: Mock user bypass when DB unavailable (see `server/sentinel/routes.ts` login endpoint)

---

## Data Flow & Caching Architecture

### Chart Metrics Endpoint (`/api/sentinel/trade-chart-metrics`)

**Request**: `GET /api/sentinel/trade-chart-metrics?ticker=AAPL&timeframe=15min`

#### **Response Structure**:

**1. Technical Data (Always Available - Calculated Live from Tiingo)**
- Computed on every request from OHLCV candles
- No backend cache
- Fields:
  - `currentPrice`: Latest close price
  - `adr20`, `adr20Dollar`, `adr20Pct`: 20-day Average Daily Range
  - `extensionFrom50dAdr`: Distance from 50-day SMA (in ADR multiples)
  - `extensionFrom50dPct`: Distance from 50-day SMA (%)
  - `extensionFrom200d`: Distance from 200-day SMA (%)
  - `extensionFrom20d`: Distance from 20-day SMA (%)
  - `macd`: "Open" or "Closed" based on MACD/Signal crossover
  - `macdTimeframe`: "daily" or intraday timeframe
  - `rsMomentum`: 63-day relative strength vs SPY
  - `sectorEtf`, `sectorEtfChange`: Sector ETF symbol and daily % change

**2. Fundamental Data (FMP API - Cached 24 Hours)**
- Retrieved via `getExtendedFundamentals(symbol)` in `server/fundamentals.ts`
- In-memory cache: `extendedCache` Map (per-symbol, 24hr TTL)
- Fields:
  - `marketCap`, `pe`, `beta`, `debtToEquity`, `preTaxMargin`
  - `analystConsensus`, `targetPrice`
  - `nextEarningsDate`, `nextEarningsDays`
  - `epsCurrentQYoY`, `salesGrowth3QYoY`, `lastEpsSurprise`

**3. Industry Peers (FMP API - Cached 12 Hours)**
- Retrieved via `fetchIndustryPeersFromFMP()` in `server/fundamentals.ts`
- In-memory cache: `fmpPeersCache` Map (per-sector:industry combo, 12hr TTL)
- Fields: `industryPeers` array with `symbol`, `name`, `industry`, `marketCap`

**4. Company Metadata (Tiingo)**
- `companyName`, `companyDescription`, `sectorName`, `industryName`
- Fetched from Tiingo ticker metadata endpoint

### Frontend Caching (React Query)

```typescript
// Chart metrics query
staleTime: 60 * 1000  // 60 seconds
// Daily/Intraday chart data queries
staleTime: 5 * 60 * 1000  // 5 minutes
```

Frontend will reuse cached data during `staleTime` window before refetching.

---

## Critical Frontend Patterns

### React Component Structure

**BigIdea Scanner Chart Viewer** (`client/src/pages/BigIdeaPage.tsx`):
- `ScanChartViewer` component renders chart overlay via `createPortal`
- **Z-index layering**:
  - Backdrop overlay: `z-0` (black 80% opacity)
  - Chart window container: `z-10` (relative positioning)
  - Debug panel: `z-50` (absolute top-right)
  - Commit banner: `z-50` (absolute center)
- **Hook Order Critical**: ALL hooks MUST be called before any conditional returns
  - `useState`, `useEffect`, `useCallback`, `useMemo`, `useQuery` hooks
  - Early returns (`if (!open) return null;`) must come AFTER all hooks
  - Violating Rules of Hooks causes React crash with "Rendered more hooks than during the previous render" error

### Chart Strips Layout (`client/src/components/DualChartGrid.tsx`)

**5-Pane Fixed Layout**:
1. **Upper Pane**: 40px fixed height (optional via `upperPane` prop)
2. **Nav + Info Row**: 76px fixed height (price ticker + company info)
3. **Charts Row**: Calculated height (fills remaining space)
4. **Fundamentals Row**: 70px fixed height (2-column grid for metrics)
5. **Lower Pane**: 24px fixed height (optional via `lowerPane` prop)

**Fundamentals Strips**:
- **Left Strip** (Daily Metrics): 5-column grid
  - Market Cap, Sales Growth, EPS YoY, Next Earnings, Analyst Consensus
  - PE, Pre-Tax Margin, Last EPS Surprise, Debt/Equity, Target Price
- **Right Strip** (Intraday Metrics): 4-column grid
  - ADR(20) $, 50d Ext (ADR), MACD, Sector ETF
  - ADR(20) %, 20d Ext %, RS Momentum, Industry Peers (clickable)

**Rendering Logic**:
```typescript
{chartMetrics ? (<>
  // Render all metric fields
</>) : null}
```
Strips only render if `chartMetrics` exists. If data is `null`, individual fields show "N/A".

---

## Known Issues & Gotchas

### **1. Empty Chart Strips - ✅ RESOLVED 2026-02-16**
**Previous Symptom**: Fundamentals/technical strips below charts were empty/blank
**Previous Causes**:
- FMP API free tier limitation → premium endpoints returned `null`
- CSS color issue → text invisible against dark background

**Solutions Applied**:
- ✅ **Migrated to Finnhub** (FREE tier with full fundamental data access)
- ✅ **CSS Fixed**: Explicit `text-white` and `text-gray-400` colors
- ✅ **All Fields Operational**: PE, Beta, Debt/Equity, Analyst Consensus, Target Price, Earnings

**Status**: ✅ Fully operational - All fundamental and technical metrics displaying correctly

**If strips appear empty after this fix**:
- Restart server to clear 24hr cache (`extendedCache` Map)
- Check browser console for API errors
- Verify Finnhub API key is valid (60 calls/min free tier)

### **2. Black Chart Screen**
**Symptoms**: Chart viewer opens to completely black screen, no content visible
**Causes**:
- **React Hooks violation**: Hook order changes between renders
  - Check for conditional returns BEFORE all hooks are called
  - Check for hooks defined AFTER early returns
- **Z-index issue**: Chart window not rendering above backdrop
  - Backdrop must be `z-0`, chart window must be `z-10` or higher
- **Component crash**: Check browser console for React errors

**Fix**: Ensure ALL hooks are called at component top, before any `if (!open) return null;`

### **3. Session/Auth Issues**
**Symptom**: API returns 401 Unauthorized despite being logged in
**Causes**:
- Session not persisted (DB unavailable, session store failing)
- `credentials: 'include'` missing from fetch calls
- Session cookie not set properly

**Fix**: Check `/api/auth/me` endpoint, verify `req.session.userId` is set

### **4. Extended Trading Hours (ETH) - ✅ RESOLVED 2026-02-16**
**Previous Issue**: ETH toggle appeared to be ON but no extended hours candles displayed
**Root Cause**: Tiingo IEX endpoint does not support `afterHours` parameter - only returns regular trading hours (9:30 AM - 4:00 PM ET)
**Solution**: Integrated Alpaca Market Data API for intraday data
  - ✅ Alpaca now handles all intraday requests (5m, 15m, 30m)
  - ✅ Extended hours fully supported (pre-market + after-hours)
  - ✅ Tiingo still handles daily/EOD data (no extended hours needed)
**Status**: ✅ **FULLY OPERATIONAL** - Test with any intraday chart + ETH toggle

### **5. Tiingo API Ticker Format**
**Issue**: Tickers with dots (e.g., `BRK.B`, `BF.B`) fail with 404
**Reason**: Tiingo uses different formats for class shares
**Workaround**: Document ticker normalization if needed

---

## Development Workflow

### Starting the Dev Server
```bash
npm run dev
```
- Vite dev server: Client hot-reload on file changes
- Express server: Backend auto-restarts via nodemon
- Port: 5000 (both client and API served from same port)

### Clearing Caches
- **Frontend (React Query)**: Hard refresh browser (`Ctrl + Shift + R`)
- **Backend (FMP fundamentals)**: Restart dev server (clears in-memory Maps)
- **Vite build cache**: `rm -rf node_modules/.vite` then restart

### Testing Chart Data
- **Endpoint**: `http://localhost:5000/api/sentinel/trade-chart-metrics?ticker=AAPL&timeframe=15min`
- **Expected Response**: JSON with `currentPrice`, `adr20`, `pe`, etc.
- **If fundamentals are `null`**: Check FMP API key validity

---

## File Organization

### **Key Backend Files**
- `server/index.ts`: Express app entry point
- `server/sentinel/routes.ts`: Main API routes (6900+ lines, includes auth, charts, trades)
- `server/sentinel/chartDataEngine.ts`: Chart data routing logic (Alpaca for intraday, Tiingo for daily)
- `server/bigidea/routes.ts`: Big Idea Scanner API
- `server/bigidea/indicators.ts`: Technical indicator calculations (PA-*, MA-*, CB-*, etc.)
- `server/fundamentals.ts`: Fundamental data orchestration (uses Finnhub, legacy FMP for peers)
- `server/finnhub.ts`: Finnhub Market Data API client (fundamentals, earnings, analyst ratings) 🆕
- `server/alpaca.ts`: Alpaca Market Data API v2 client (intraday + extended hours)
- `server/tiingo.ts`: Tiingo API client (daily/EOD data)
- `server/db.ts`: Database initialization

### **Key Frontend Files**
- `client/src/pages/BigIdeaPage.tsx`: Scanner UI (6800+ lines, includes `ScanChartViewer`)
- `client/src/components/TradingChart.tsx`: Lightweight-charts wrapper
- `client/src/components/DualChartGrid.tsx`: 5-pane chart layout
- `client/src/context/SentinelAuthContext.tsx`: Auth state management

### **Configuration**
- `.env`: API keys, database URL
- `CHANGELOG.md`: Development history with timestamps
- `SYSTEM.md`: This file - architecture reference (update on changes!)

---

## AI Assistant Guidelines

### Before Each Session
1. Read this `SYSTEM.md` file
2. Review recent `CHANGELOG.md` entries for context
3. Check `.env` for configured API keys
4. Check TODO list for outstanding tasks (ask "What are the outstanding tasks?")

### When Making Changes
1. **Hooks**: Verify all React hooks are called before conditional returns
2. **Caching**: Consider cache TTLs when modifying data fetching
3. **Documentation**: Update `SYSTEM.md` if changing architecture
4. **Changelog**: Always update `CHANGELOG.md` with timestamp and description
5. **Z-index**: When modifying overlays, maintain z-index hierarchy

### Code Standards
- TypeScript strict mode
- Use Drizzle ORM for database queries
- Use React Query (`useQuery`, `useMutation`) for API calls
- Follow existing `cssVariables` pattern for dynamic colors
- Always add `credentials: 'include'` to authenticated fetch calls

---

## Debugging Tools

### Frontend Debug Panel
- **Location**: Top-right blue box in chart viewer (when enabled)
- **Shows**: Symbol, data loading status, candle counts, metrics status
- **How to enable**: Uncomment debug panel JSX in `BigIdeaPage.tsx`

### Browser Console
- Check for `[ScanChartViewer]` log messages
- Check for React errors (red text)
- Network tab: Filter by API endpoint names

### Server Logs
- Located in: `terminals/*.txt` files
- Check for: API errors, Tiingo failures, FMP rate limit issues

---

## Product Vision & Target Users

**Target Audience**: Swing Traders, Long-Term Investors, Intraday (non-scalping)
- NOT a pure day-trading/scalping system
- Focus on multi-day to multi-week holding periods
- Emphasis on quality setups over quantity

---

## Development Roadmap

### PRIORITY 1: UI/UX Improvements

| Task | Description | Status |
|------|-------------|--------|
| Contextual Help Panel | When user hovers/clicks indicator in library, show full description + example use cases | TODO |
| "Why this indicator?" Tooltip | On AI-generated thoughts, explain AI's reasoning for choosing each indicator | TODO |
| Smart Linking Warnings | When user adds PA-14/15/16 without upstream PA-3, show warning banner with explanation | TODO |
| Base-Aware Follow-up | After AI creates thought with VOL-4/VLT-2, ask "Would you like to make this base-aware for more precision?" | TODO |
| Progress Streaming | Show incremental scan results as each thought completes (better UX for large universes) | TODO |

### PRIORITY 2: Indicator Library Expansion

**Technical Indicators (High Priority)**:
| ID | Name | Category | Status |
|----|------|----------|--------|
| `BB-1` | Bollinger Band Squeeze | Volatility | TODO |
| `BB-2` | Price vs Bollinger Bands | Volatility | TODO |
| `RSI-1` | RSI Value | Momentum | TODO |
| `RSI-2` | RSI Divergence | Momentum | TODO |
| `MACD-1` | MACD Crossover | Momentum | TODO |
| `MACD-2` | MACD Histogram Direction | Momentum | TODO |
| `STOCH-1` | Stochastic Oscillator | Momentum | TODO |
| `ADX-1` | ADX Trend Strength | Trend | TODO |

**Fundamental Filters (Medium Priority)**:
| ID | Name | Category | Status |
|----|------|----------|--------|
| `FND-1` | Market Cap Filter | Fundamental | TODO |
| `FND-2` | PE Ratio Filter | Fundamental | TODO |
| `FND-3` | Sector Filter | Fundamental | TODO |
| `FND-4` | Earnings Proximity | Fundamental | TODO |

**Intraday-Specific (Medium Priority)**:
| ID | Name | Category | Status |
|----|------|----------|--------|
| `ITD-1` | Opening Range Breakout | Intraday | TODO |
| `ITD-2` | VWAP Reclaim | Intraday | TODO |
| `ITD-3` | Pre-market Gap | Intraday | TODO |

### PRIORITY 3: Find Base (CB-1) Refinement

| Task | Description | Status |
|------|-------------|--------|
| Verify cocHighlight | Ensure CB-1 returns `cocHighlight` data for chart annotations | TODO |
| Base Zone Drawing | Confirm resistance lines render correctly (top/bottom of base) | TODO |
| Preset Templates | Create preset ideas showcasing CB-1 chaining (base→advance→base) | TODO |
| Accuracy Tuning | Refine base detection parameters for better hit rate | TODO |

### PRIORITY 4: Performance Optimization

| Task | Description | Status |
|------|-------------|--------|
| Parallel Fetching | Use `p-limit` for concurrent OHLCV fetches (10 parallel) | TODO |
| Pre-Filter Universe | Run cheap filters (price, volume) first to reduce ticker count | TODO |
| Extended Daily Cache | Increase daily OHLCV cache TTL (4+ hours, not 5 min) | TODO |
| DB-Backed OHLCV Cache | Move from in-memory Map to PostgreSQL for persistence | TODO |
| Batch Tiingo Requests | Use multi-symbol endpoints if available | TODO |

### PRIORITY 5: Scoring & Learning System Improvements

| Task | Description | Status |
|------|-------------|--------|
| Per-Thought Attribution | Track which thought was most restrictive (most responsible for result) | TODO |
| Regime-Tagged Learning | Store current regime with tuning sessions, segment historical performance | TODO |
| Retention Scoring | Weight validated price outcomes higher than raw thumbs-up | TODO |

### PRIORITY 6: Outcome Tracking System (Major Feature)

**Phase 1 - Foundation**:
| Task | Description | Status |
|------|-------------|--------|
| `scan_outcome_records` Table | Store scan context (entry price, ATR, SMAs, RSI, regime) | TODO |
| Outcome Capture | On each result rating, capture full context snapshot | TODO |
| Daily Price Cron | Fetch prices and calculate 1d/5d/10d/20d returns | TODO |
| Outcome Classification | Mark winners/losers/scratches based on objective rules | TODO |
| Basic Dashboard | Show win/loss rates in admin UI | TODO |

**Phase 2 - Attribution**:
| Task | Description | Status |
|------|-------------|--------|
| Restrictiveness Score | Calculate which thought filtered most aggressively | TODO |
| Uniqueness Score | Identify which indicator uniquely caught each winner | TODO |
| Counterfactual Analysis | "If we removed Thought B, would stock still pass?" | TODO |
| Per-Indicator Stats | Store outcome stats per indicator+params+regime | TODO |

**Phase 3 - Regime Learning**:
| Task | Description | Status |
|------|-------------|--------|
| Regime Segmentation | Query historical performance by matching regime | TODO |
| AI Context Injection | Include regime-specific performance in tuning prompts | TODO |
| Current Regime Widget | Show "This indicator's performance in current regime" | TODO |

**Phase 4 - Agentic Features**:
| Task | Description | Status |
|------|-------------|--------|
| Nightly Learning Agent | Cron: fetch outcomes, classify, attribute, aggregate, analyze | TODO |
| Adaptive Param Agent | On scan run, suggest regime-optimal params | TODO |
| Backtest-on-Demand | "How would this idea have performed last month?" | TODO |
| Paper Trading Agent | Auto paper-trade every scan result, track virtual P&L | TODO |
| Sector Rotation Agent | Monitor leading sectors, suggest universe filters | TODO |
| Earnings Avoidance Agent | Flag stocks with earnings in next 5 days | TODO |
| Correlation Agent | "Your last 5 winners all had RS > 10% — add RS-1?" | TODO |
| Regime Shift Detector | Alert when market regime changes, suggest adjustments | TODO |
| Idea Suggester | "Based on current regime and past winners, try this preset..." | TODO |

**Phase 5 - Machine Learning**:
| Task | Description | Status |
|------|-------------|--------|
| Training Data Export | Export scan features + outcomes for ML training | TODO |
| Winner/Loser Classifier | Predict outcome probability from scan features | TODO |
| Scan Confidence Badge | Show "High/Medium/Low confidence" based on ML prediction | TODO |
| Continuous Retraining | Pipeline to retrain model on new outcomes | TODO |

### Existing Issues (From Previous Sessions)

| Task | Description | Status |
|------|-------------|--------|
| Fix Fundamentals Strip | FMP API returning null for PE, D/E, Target Price - investigate tier access | TODO |
| Remove Debug Panel | Remove temporary debug panel from chart viewer | TODO |

---

**Last Updated**: 2026-02-16
**Maintained by**: AI Assistant + Development Team
