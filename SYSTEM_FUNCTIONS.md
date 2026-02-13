# System Functions Reference

Complete documentation of all features, how they work, and where the code lives.

---

## Table of Contents
1. [Authentication & Users](#authentication--users)
2. [Dashboard](#dashboard)
3. [Trade Evaluator (Ivy AI)](#trade-evaluator-ivy-ai)
4. [Trading Rules](#trading-rules)
5. [Trade Import System](#trade-import-system)
6. [Order Levels Management](#order-levels-management)
7. [Charts Page (Standalone)](#charts-page-standalone)
8. [BigIdea Scanner](#bigidea-scanner)
9. [AI Scan Tuning](#ai-scan-tuning)
10. [Scan Learning Loop](#scan-learning-loop)
11. [Chart Rating System](#chart-rating-system)
12. [Pattern Training Tool](#pattern-training-tool)
13. [Watchlist](#watchlist)
14. [Market Sentiment Engine](#market-sentiment-engine)
15. [AI Collective Learning](#ai-collective-learning)
16. [Trader Neural Network (TNN)](#trader-neural-network-tnn)
17. [Admin Panel](#admin-panel)
18. [TradingChart Component](#tradingchart-component)
19. [External Data Sources](#external-data-sources)

---

## Authentication & Users

### How It Works
Session-based authentication stored in PostgreSQL. Users log in with username/password, sessions persist via cookies.

### User Tiers
| Tier     | Access Level |
|----------|-------------|
| Standard | Basic dashboard, trade submission, evaluations, rules, imports |
| Pro      | All standard features + AI Scan Tuning, advanced scanner features |
| Admin    | All pro features + User Management, TNN, Tuning Review Queue, System Settings |

### Key Files
- **Frontend**: `SentinelLoginPage.tsx`
- **Backend**: `server/sentinel/routes.ts` (auth endpoints)
- **Schema**: `shared/schema.ts` (users table)

### API Endpoints
- `POST /api/sentinel/login` — Login
- `POST /api/sentinel/register` — Register
- `POST /api/sentinel/logout` — Logout
- `GET /api/sentinel/me` — Current user session

---

## Dashboard

### How It Works
Main landing page after login. Shows all trades organized by status tabs: Active, Watch, Closed, All. Each trade displays as a "trade card" with ticker, direction (LONG/SHORT), position details, P&L, and action buttons.

### Trade Cards Display
- **Ticker Widget**: Shows ticker symbol with live price, direction badge (LONG/SHORT green/red)
- **Position Info**: Shares quantity, P&L dollar amount, P&L percentage (hidden for Watch status)
- **Action Buttons**: Evaluate (opens Ivy AI), Chart (opens dual-chart view with position lines)
- **Status Badges**: WATCH, ACTIVE, CLOSED with context colors
- **Order Levels**: Stop loss and profit target levels displayed with proximity alerts

### Trade Card Chart View
Opens a dual-chart layout showing the position's ticker with:
- Entry price line (green dashed)
- Exit price line (if closed)
- Stop loss line (red dashed)
- Target price line (amber dashed)
- Supports clicking chart bars to refine execution timestamps

### Key Files
- **Frontend**: `SentinelDashboardPage.tsx`
- **Backend**: `server/sentinel/routes.ts` (trade CRUD, status updates)

### API Endpoints
- `GET /api/sentinel/trades` — Get all trades for current user
- `POST /api/sentinel/trades` — Create new trade
- `PATCH /api/sentinel/trades/:id/status` — Update trade status
- `DELETE /api/sentinel/trades/:id` — Delete trade

---

## Trade Evaluator (Ivy AI)

### How It Works
AI-powered trade evaluation using OpenAI. Users submit a trade idea (ticker, direction, entry, stop, target) and Ivy AI analyzes it against market data, technical indicators, and the user's personal rules.

### Evaluation Flow
1. User enters trade parameters (ticker, direction, entry price, stop, targets)
2. System fetches technical data (price history, indicators, sector info, fundamentals)
3. Trade details + technical data + user's rules sent to OpenAI
4. AI generates structured evaluation

### Evaluation Output (Three Tabs)
1. **Trade Analysis**: Decision gate (GO/CAUTION/NO-GO), model tag detection, trade snapshot, logical stops/TP analysis, risk flags, improvements, rule adherence checklist
2. **Industry Comps**: Sector ETFs and peer stocks comparison
3. **News**: Recent news context for the ticker

### AI Models
- `gpt-5.1` — Standard evaluations
- `gpt-5.2` — Deep evaluations (more thorough analysis)

### Features
- Bloomberg-style company info box
- Collapsible profit sections
- Stop presets (ATR-based, percentage-based, structure-based)
- Context-sensitive back navigation
- State preservation (results saved on navigation, restored on return)

### Key Files
- **Frontend**: `SentinelEvaluatePage.tsx`
- **Backend**: `server/sentinel/evaluate.ts`, `server/sentinel/prompts.ts`
- **Technicals**: `server/sentinel/technicals.ts`

### API Endpoints
- `POST /api/sentinel/evaluate` — Submit trade for evaluation
- `GET /api/sentinel/evaluate/:id` — Get evaluation result

---

## Trading Rules

### How It Works
Users create personal trading rules that Ivy AI checks against during evaluations. Rules can be toggled on/off and are included in the AI prompt as a checklist.

### AI Collective Learning
The system tracks rule performance across all users. When patterns emerge (e.g., a particular rule consistently correlates with winning trades), GPT-4o suggests new rules to the community.

### Key Files
- **Frontend**: `SentinelRulesPage.tsx`
- **Backend**: `server/sentinel/routes.ts`, `server/sentinel/suggest.ts`

### API Endpoints
- `GET /api/sentinel/rules` — Get user's rules
- `POST /api/sentinel/rules` — Create rule
- `PATCH /api/sentinel/rules/:id` — Update rule
- `DELETE /api/sentinel/rules/:id` — Delete rule

---

## Trade Import System

### How It Works
Multi-broker CSV import system for importing historical trades from brokerage accounts.

### Features
- **Auto-Broker Detection**: Detects Fidelity, TD Ameritrade, Schwab, etc. from CSV format
- **Preview Before Confirm**: Shows parsed trades before importing
- **Partial Fill Detection**: Combines multiple fills into single positions
- **Smart Orphan Sell Detection**: Identifies sell orders without matching buy positions
- **Incremental Merge Promotion**: Updates existing trade cards with new data
- **Orphan Resolution**: Dedicated Orphans tab with filtering and inline editing
- **Orders Import**: Processes Fidelity Orders CSV files for stop/target order levels

### Position Splitting Rule
Buys and sells on the same day belong to the same position. FIFO matching tracks P&L accurately.

### Key Files
- **Frontend**: `SentinelImportPage.tsx`
- **Backend**: `server/sentinel/tradeImport.ts`

---

## Order Levels Management

### How It Works
Supports multiple stop loss and profit target orders per trade. Orders are displayed on trade cards with proximity alerts when current price approaches order levels.

### Features
- Multiple stops and targets per trade
- Proximity alert badges when price is near stop/target
- Visual display on trade card chart view
- Import from Fidelity Orders CSV

### Key Files
- **Frontend**: `SentinelDashboardPage.tsx` (display), `SentinelImportPage.tsx` (import)
- **Backend**: `server/sentinel/routes.ts`

---

## Charts Page (Standalone)

### How It Works
Dedicated page at `/sentinel/charts` for viewing any ticker's charts without needing an active trade. Enter a ticker symbol and see daily + intraday charts side by side.

### Features
- Ticker search with autocomplete
- Dual-chart layout (Daily + Intraday)
- Timeframe selector for intraday (5m, 15m, 30m)
- MA legend showing SMA 5/10/21/50/200 with EMA 200d
- VWAP overlay on intraday
- Trend line drawing tool
- Measurement/ruler tool
- ETH (Extended Trading Hours) toggle for pre/post market data
- MA settings customization dialog

### Metrics Strips
**Below Daily Chart**: Market Cap, Sales Growth 3Q YoY, EPS Current Q YoY, Next Earnings, Analyst Consensus, PE, Pre-Tax Margin, Last EPS Surprise, Debt/Equity, Target Price

**Below Intraday Chart**: ADR(20) $, 50d Extension (ADR), MACD status, Sector ETF (clickable), ADR(20) %, 20d Extension %, RS Momentum, Industry Peers (clickable)

### Company Info
Displays company name, sector/industry, and truncated company description near ticker.

### Watchlist Button
Add current ticker to watchlist directly from charts page.

### Key Files
- **Frontend**: `SentinelChartsPage.tsx`
- **Backend**: `server/sentinel/routes.ts` (`/api/sentinel/trade-chart-metrics`, `/api/sentinel/pattern-training/chart-data`)
- **Chart Component**: `client/src/components/TradingChart.tsx`

---

## BigIdea Scanner

### How It Works
Visual canvas-based scan builder where users create complex multi-thought stock screens. Each "thought" is a criteria node containing one or more technical indicators. Thoughts connect via edges (AND logic or OR logic) to build scan chains.

### Canvas Interface
- **Nodes**: Thought nodes containing indicator criteria
- **Edges**: AND connections (solid) or OR connections (dashed) between thoughts
- **AI Generation**: Type natural language description → AI generates thought nodes with proper indicators and connections
- **Drag-and-Drop**: Reposition nodes on canvas

### Scan Execution Flow
1. User builds scan on canvas (manually or via AI)
2. Selects stock universe (S&P 500, Nasdaq 100, Russell 2000, Full Market, etc.)
3. Clicks "Scan" — backend evaluates every ticker against the criteria chain
4. Results displayed as count badge, clickable to open chart viewer
5. Chart viewer shows dual-chart layout for each result with navigation arrows

### Indicator Data-Passing System
Indicators can pass data between each other using `provides` and `consumes` declarations. Example: a "52-Week High Detection" indicator provides `highPrice` that a downstream "Consolidation Base" indicator consumes as its reference point.

### Scan Failure Funnel
Returns detailed pass/fail counts for tickers at each stage. Shows how many tickers passed/failed each thought, helping users identify overly restrictive criteria.

### Chart Viewer (Scanner Results)
- Dual-chart layout (Daily + Intraday) for each scan result
- Navigation arrows to browse through results
- Pattern-specific overlay lines (resistance, support, etc.)
- CoC (Change of Character) highlight markers
- All standard tools (measure, trend line, ETH toggle, MA settings)
- Chart rating system (thumbs up/down)

### 40+ Technical Indicators
Including: Volume Dry-Up, Flat Consolidation Base, SMA Crossover, Price Tightening, Relative Strength, Breakout Volume, ADR Filter, Market Cap Filter, Sector Filter, VWAP Reclaim, Gap Up, Earnings Catalyst, and many more.

### Preset Scan Templates
Curated configurations: VCP (Volatility Contraction Pattern), High Tight Flag, RS Leader, Coiling Base.

### Key Files
- **Frontend**: `BigIdeaPage.tsx` (main page — very large file containing canvas, nodes, scan logic, chart viewer, tuning, ratings)
- **Backend**: `server/sentinel/routes.ts` (scan execution, AI generation, indicator engine)

---

## AI Scan Tuning

### How It Works
Pro/Admin feature. After running a scan, users can ask AI to suggest parameter adjustments to improve results.

### Tuning Flow
1. User runs scan and reviews results
2. Opens tuning dialog → AI analyzes funnel data, current params, learning history
3. AI suggests parameter changes with explanations
4. User can Apply/Undo individual suggestions, Apply All, or request More Suggestions
5. "Review on Chart" rescans with new params and opens chart viewer for rating
6. "Save & Commit Tuning" records the tuning session (requires 30% chart rating threshold)
7. "Discard" reverts all changes and records as negative signal

### Guardrails
- Auto-link protection (won't break data-linking between indicators)
- Parameter bounds enforcement
- Value clamping/snapping to valid ranges

### AI Context Injection
- Current market regime (weekly trend, daily basket, choppiness, SPY price)
- Current universe
- Matching archetype performance from historical data
- Per-indicator aggregated stats (param ranges, retention rates, avoid params)

### Admin Approval Gate
- Admin commits: auto-approved, immediately feed learning summary
- Pro user commits: go to `pending_review` status, appear in admin review queue
- Admin approval triggers learning summary upsert; rejection blocks it

### Key Files
- **Frontend**: `BigIdeaPage.tsx` (tuning dialog)
- **Backend**: `server/sentinel/routes.ts` (tuning API, learning summary)

---

## Scan Learning Loop

### How It Works (Phases 1-4)
A feedback loop that improves scan tuning over time by learning from user ratings and tuning outcomes.

### Data Flow
1. **Scan Session** (`scan_sessions` table): Records every scan run — config, result count, symbols, funnel data
2. **Chart Ratings**: User thumbs-up/down on results, stored with session ID and full indicator snapshot
3. **Tuning History** (`scan_tuning_history` table): Records tuning commits/discards with before/after configs, accepted/skipped suggestions, symbol retention metrics
4. **Learning Summary** (`indicator_learning_summary` table): Aggregated per-indicator stats — param ranges, regime/universe/archetype performance, retention rates

### Enrichment Fields
- Market regime JSONB snapshot
- Universe (text)
- Archetype tags (extracted from thought names via 18 regex patterns)
- Tuning directions (per-indicator tightened/loosened/mixed)
- Acceptance ratio

### Hybrid Learning Context
All-time aggregated stats + last 30 raw sessions for recency balance.

---

## Chart Rating System

### How It Works
Users rate scan results via thumbs-up/down in the chart viewer. Ratings feed into the scan learning loop.

### Rating Data
- Linked to scan session via `sessionId`
- Includes full `indicatorSnapshot` (per-indicator criteria results and diagnostics)
- 30% rating threshold required before committing tuning changes

---

## Pattern Training Tool

### How It Works
Interactive chart-based system for users to practice annotating stock setups. Users mark key points on charts (entry, pivot, breakout, etc.) and the system captures 40+ technical indicators at each annotated point.

### Features
- Modular TradingChart component
- Point annotation with indicator capture
- Custom MA settings
- Dual-chart layout

### AI Setup Evaluation
Scores annotated setups, provides feedback, and uses a learning layer to analyze historical outcomes.

### Key Files
- **Frontend**: `PatternTrainingPage.tsx`, `PatternLearningPage.tsx`
- **Backend**: `server/sentinel/patternTrainingEngine.ts`, `server/sentinel/patternEvaluationEngine.ts`

---

## Watchlist

### How It Works
Users can add tickers to their watchlist from multiple points (dashboard, charts page). Watchlist items appear in the Dashboard under the "Watch" tab and on the dedicated Watchlist page.

### Features
- Live ticker prices via Tiingo quotes
- Quick action buttons
- Chart navigation stays within Sentinel
- Add from Charts page via "Watchlist" button

### Key Files
- **Frontend**: `WatchlistPage.tsx`, `SentinelDashboardPage.tsx`
- **Backend**: `server/sentinel/routes.ts`

---

## Market Sentiment Engine

### How It Works
Gauges overall market sentiment through various market indicators to influence AI scoring during evaluations and scan tuning.

### Indicators Tracked
- Weekly trend direction
- Daily basket breadth
- Choppiness index
- SPY price action
- Cached and refreshed periodically

### Key Files
- **Backend**: `server/sentinel/sentiment.ts`

---

## AI Collective Learning

### How It Works
Tracks rule performance across all users. When patterns emerge (e.g., a rule consistently correlates with winning trades), GPT-4o analyzes the data and suggests new rules to the community.

### Key Files
- **Backend**: `server/sentinel/suggest.ts`

---

## Trader Neural Network (TNN)

### How It Works
Admin-only feature. Adaptive factor weighting system based on trade outcomes. Learns which factors (technical indicators, market conditions, etc.) correlate most strongly with successful trades.

### Key Files
- **Backend**: `server/sentinel/tnn.ts`

---

## Admin Panel

### How It Works
Admin-only page for system management.

### Features
- **User Management**: View/edit users, change tiers, reset passwords
- **System Settings**: Customize UI colors (overlay colors, background), logo transparency, chart appearance
- **Tuning Review Queue**: Review and approve/reject Pro user scan tuning commits

### System Settings (SystemSettingsProvider)
Configurable properties:
- `overlayBg` — Primary overlay color (used for chart headers, etc.)
- `secondaryOverlayColor` — Secondary overlay color
- `backgroundImage` — Dashboard background
- `logoTransparency` — Logo opacity

### Key Files
- **Frontend**: `SentinelAdminPage.tsx`
- **Context**: `client/src/context/SystemSettingsContext.tsx`
- **Backend**: `server/sentinel/routes.ts`

---

## TradingChart Component

### How It Works
Shared charting component used across multiple pages. Renders candlestick charts with technical indicators using lightweight-charts library.

### Features
- Candlestick rendering with volume bars
- SMA overlays (5, 10, 21, 50, 200) with EMA 200d
- VWAP line on intraday charts
- Anchored VWAP (high/low)
- Day dividers on intraday charts
- Measurement/ruler mode
- Trend line drawing mode
- Price level lines (entry, exit, stop, target)
- Pattern overlay lines (resistance, support)
- CoC (Change of Character) highlight markers
- MA legend display
- Configurable max bars
- RTH (Regular Trading Hours) filtering

### Props
- `data` — Chart data (candles + indicators)
- `timeframe` — "daily" | "5min" | "15min" | "30min"
- `height` — Chart height in pixels
- `showLegend` — Show/hide MA legend
- `showDayDividers` — Show day separator lines
- `maSettings` — Custom MA configuration
- `maxBars` — Maximum bars to display
- `measureMode` — Enable measurement tool
- `trendLineMode` — Enable trend line drawing
- `priceLines` — Array of horizontal price lines
- `overlayLines` — Pattern-specific overlay drawings

### Key Files
- **Component**: `client/src/components/TradingChart.tsx`

---

## External Data Sources

### Tiingo API (Business Tier)
- **EOD Prices**: Daily, weekly, monthly historical data
- **IEX Intraday**: 5min/15min/30min candle data
- **Extended Hours**: Pre-market and after-hours data via `afterHours=true`
- **Real-time Quotes**: Latest price, change, volume
- **Ticker Metadata**: Company name, description, exchange code

### Financial Modeling Prep (FMP) API (Free Tier)
- **Fundamentals Fallback**: Sector, industry, market cap for tickers not in local lookup tables
- Used when Tiingo doesn't have fundamental data

### OpenAI API
- `gpt-5.1` — Standard trade evaluations, AI scan tuning
- `gpt-5.2` — Deep trade evaluations
- `gpt-4o` — AI collective learning rule suggestions

### Key Files
- **Tiingo**: `server/tiingo.ts`
- **FMP**: `server/sentinel/routes.ts` (inline fetch calls)
- **OpenAI**: `server/sentinel/evaluate.ts`, `server/sentinel/prompts.ts`
