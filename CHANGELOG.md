# Change Log

All completed development tasks, fixes, and features are tracked here with dates, descriptions, and test status.

---

## 2026-02-13

### DualChartGrid Component Extraction
- **Task**: Extracted shared dual-chart layout (Daily + Intraday) into a reusable `DualChartGrid` component, eliminating ~400 lines of duplicate code across BigIdeaPage and SentinelChartsPage
- **Files**: `DualChartGrid.tsx` (new), `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Details**: DualChartGrid encapsulates chart headers/toolbars (measure, trend line, ETH toggle), RTH filtering, resize handling, MA settings dialog, metrics strips, loading/empty states. Scanner-specific features (CoC markers, diamond markers, price lines, resistance lines) passed via `dailyChartProps`. Exports shared `ChartMetrics` and `ChartDataResponse` types.
- **Tested**: App compiles and runs without errors; both chart viewers render identically to pre-refactor
- **Status**: Complete

### Chart Header Overlay Unification
- **Task**: Changed Daily/Intraday header bars from `secondaryOverlayColor` (light gray) to `overlayBg` (admin-configurable primary overlay) with white text
- **Files**: `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Tested**: Visual — headers now use coordinated dark overlay background on both pages
- **Status**: Complete

### Company Metadata on Chart Viewers
- **Task**: Added company name, sector/industry, and company description near ticker symbol display in both BigIdea chart viewer and standalone Charts page
- **Files**: `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`, `server/sentinel/routes.ts`
- **Details**: Fetches Tiingo ticker meta (name, description) and sector/industry info. Description shown as 2-line truncated text with hover for full text.
- **Tested**: Verified API response includes `companyName`, `companyDescription`, `sectorName`
- **Status**: Complete

### Dashboard Trade Card Icon Sizing
- **Task**: Enlarged Evaluate (MessageSquare) and Chart (BarChart3) action icons from 3.5x3.5 to 5x5, buttons from h-7 w-7 to default `size="icon"` (h-9 w-9)
- **Files**: `SentinelDashboardPage.tsx`
- **Tested**: Visual confirmation icons are larger and more clickable
- **Status**: Complete

### Hide Watch Quantity Display
- **Task**: Removed qty/PnL information display for watchlist items (status="watch") on dashboard trade cards. Only WATCH badge shows.
- **Files**: `SentinelDashboardPage.tsx`
- **Tested**: Watchlist cards show WATCH badge without spurious qty/PnL
- **Status**: Complete

---

## 2026-02-12

### VWAP Rendering Fix
- **Task**: Fixed VWAP not displaying when RTH filtering is active. Added `vwap`, `avwapHigh`, `avwapLow` to rthData indicators mapping.
- **Files**: `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Tested**: VWAP overlay renders correctly with RTH-only intraday view
- **Status**: Complete

### Extended Trading Hours (ETH) Support
- **Task**: Added ETH toggle to intraday charts to show pre-market and after-hours candles. Uses Tiingo `afterHours=true` parameter.
- **Files**: `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`, `server/sentinel/routes.ts`, `server/tiingo.ts`
- **Details**: `includeETH` query param → Tiingo `afterHours=true` → returns full session data including pre/post market
- **Tested**: Toggle switches between RTH-only and full-session data
- **Status**: Complete — ETH data availability depends on ticker (some tickers have no extended hours data from Tiingo)

### Resistance Lines on Charts
- **Task**: Added support for displaying resistance level lines on scan result charts
- **Files**: `TradingChart.tsx`, `BigIdeaPage.tsx`
- **Tested**: Resistance lines render at correct price levels
- **Status**: Complete

### Chart Diamond Markers
- **Task**: Updated chart markers to use diamonds for specific scan indicators, suppressed non-base indicator markers on base scans
- **Files**: `TradingChart.tsx`, `BigIdeaPage.tsx`
- **Tested**: Diamond markers display correctly, non-relevant markers hidden
- **Status**: Complete

---

## 2026-02-11

### Trend Line Drawing Tool
- **Task**: Added ability to draw trend lines on both Daily and Intraday charts with click-and-drag interface
- **Files**: `TradingChart.tsx`, `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Details**: Toggle button activates trend line mode. Click two points to draw a line. Lines persist while viewing chart.
- **Tested**: Lines draw correctly between selected points on both chart types
- **Status**: Complete

### Measurement Tool
- **Task**: Added ruler/measurement mode to both chart types for measuring price distance and percentage between two points
- **Files**: `TradingChart.tsx`, `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Tested**: Measurements display correctly with price and percentage delta
- **Status**: Complete

### Wedge Pop Indicator
- **Task**: Added new indicator for detecting stock "wedge pop" patterns in the BigIdea scanner
- **Files**: `BigIdeaPage.tsx`, indicator engine
- **Tested**: Indicator detects wedge breakout patterns correctly
- **Status**: Complete

---

## 2026-02-10

### Standalone Charts Page
- **Task**: Created dedicated Charts page (`/sentinel/charts`) for viewing any ticker's daily and intraday charts with full technical indicators and fundamental metrics
- **Files**: `SentinelChartsPage.tsx`, `server/sentinel/routes.ts`
- **Details**: Ticker search, dual-chart layout, MA legend, metrics strips (market cap, PE, earnings, sector ETF, etc.), sector ETF clickable navigation, industry peers
- **Tested**: Charts load for various tickers, metrics display correctly
- **Status**: Complete

### OR Logic for Scan Thoughts
- **Task**: Added explicit OR logic edges between thoughts in the BigIdea canvas, allowing alternative criteria paths
- **Files**: `BigIdeaPage.tsx`
- **Details**: OR edges displayed distinctly, scan engine evaluates alternative paths correctly
- **Tested**: Scans with OR paths return correct results
- **Status**: Complete

---

## 2026-02-09

### Mute Thoughts Feature
- **Task**: Added ability to mute/bypass individual thoughts in scan configurations without deleting them
- **Files**: `BigIdeaPage.tsx`
- **Tested**: Muted thoughts are skipped during scan execution
- **Status**: Complete

### Scan Quality Rating System
- **Task**: Evaluates idea scans across 5 dimensions (Criteria Diversity, Filter Funnel, Data Linking, Parameter Quality, Signal Coverage) with letter grades
- **Files**: `BigIdeaPage.tsx`, `server/sentinel/routes.ts`
- **Tested**: Quality ratings generate appropriate grades and suggestions
- **Status**: Complete

---

## 2026-02-08

### AI Scan Tuning
- **Task**: GPT-5.1-powered parameter adjustment suggestions for Pro/Admin users based on funnel data, learning history, and market regime
- **Files**: `BigIdeaPage.tsx`, `server/sentinel/routes.ts`
- **Details**: Apply/Undo per-suggestion, Apply All, More Suggestions, Review on Chart workflow. Guardrails for valid parameter ranges.
- **Tested**: Suggestions generate correctly, Apply/Undo cycle works, parameter bounds enforced
- **Status**: Complete

### Chart Rating System
- **Task**: Thumbs-up/down ratings on scan result charts feeding into personalized AI scan tuning
- **Files**: `BigIdeaPage.tsx`, `server/sentinel/routes.ts`
- **Tested**: Ratings persist, 30% threshold enforced for tuning commits
- **Status**: Complete

### Clear Idea Button
- **Task**: Added Clear Idea button with confirmation dialog to reset canvas to empty state
- **Files**: `BigIdeaPage.tsx`
- **Tested**: Clears all nodes, edges, results, debug info, quality ratings, funnel data
- **Status**: Complete

---

## 2026-02-07

### Scan Learning Loop (Phases 1-4)
- **Task**: Complete learning loop: scan sessions tracking, indicator snapshots, tuning commit/discard flow, admin approval gate, hybrid learning context
- **Files**: `BigIdeaPage.tsx`, `server/sentinel/routes.ts`, `shared/schema.ts`
- **Details**: `scan_sessions` spine, `scan_tuning_history` with enrichment fields (market regime, universe, archetype tags, tuning directions), `indicator_learning_summary` for aggregated stats. Admin approval gate for non-admin commits.
- **Tested**: Full commit/discard workflow, admin review queue, learning summary upsert
- **Status**: Complete

### Preset Scan Templates
- **Task**: Curated scan configurations (VCP, High Tight Flag, RS Leader, Coiling Base) for quick setup
- **Files**: `BigIdeaPage.tsx`
- **Tested**: Templates load correctly and populate canvas with proper nodes/edges
- **Status**: Complete

---

## 2026-02-06

### Watchlist Enhancements
- **Task**: Added live stock tickers and action buttons to watchlist items, chart navigation stays within Sentinel
- **Files**: `WatchlistPage.tsx`, `SentinelDashboardPage.tsx`
- **Tested**: Watchlist shows live prices, chart navigation works correctly
- **Status**: Complete

### Trading Card Chart View
- **Task**: Position chart view with entry/exit/stop/target price lines, dual-chart layout
- **Files**: `SentinelDashboardPage.tsx`, `TradingChart.tsx`
- **Tested**: Price lines display at correct levels
- **Status**: Complete

---

## Earlier (Pre-2026-02-06)

### Core Sentinel Features
- Session-based authentication with PostgreSQL
- Trade submission with dynamic ticker lookup
- AI trade evaluation (Ivy AI) with gpt-5.1/gpt-5.2
- Personal trading rules with rule adherence checklists
- Trade import system (multi-broker CSV, partial fills, orphan detection)
- Order levels management with proximity alerts
- Market sentiment engine
- AI collective learning for rule suggestions
- Trader Neural Network (TNN) for admin
- User tier system (standard, pro, admin)
- Pattern Training Tool with AI setup evaluation
- System settings admin panel (colors, overlays, logo)

### Core Scanner Features
- BigIdea visual canvas with node-based scan building
- AI-powered scan generation from natural language
- Multi-timeframe analysis (daily + intraday)
- 40+ technical indicators with data-passing system
- Scan failure funnel with per-stage diagnostics
- Multiple stock universes (S&P 500, Nasdaq 100, Russell 2000, etc.)
