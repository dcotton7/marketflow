# Change Log

All completed development tasks, fixes, and features are tracked here with dates, timestamps, descriptions, and test status. Every entry includes a timestamp in HH:MM UTC format.

---

## 2026-02-13

### Platform-Wide Admin Styling Normalization — 22:00 UTC
- **Task**: Audit and normalize ALL Rubric Shield pages so every header, overlay, background, and text tier draws from the admin-configurable database settings (SystemSettings CSS variables).
- **Files**: `SystemSettingsContext.tsx`, `SentinelHeader.tsx`, `SentinelDashboardPage.tsx`, `SentinelEvaluatePage.tsx`, `SentinelRulesPage.tsx`, `SentinelImportPage.tsx`, `WatchlistPage.tsx`, `PatternTrainingPage.tsx`, `PatternLearningPage.tsx`, `BigIdeaPage.tsx`, `ScannerPage.tsx`, `SymbolPage.tsx`, `SentinelTradePage.tsx`, `SentinelLoginPage.tsx`
- **Details**:
  - **SystemSettingsContext**: Added `headerBg` (overlay color + 10% more opacity) and `overlayColor` as computed CSS variables. Exported `CssVariables` type. Refactored to shared `buildCssVariables()` helper.
  - **SentinelHeader**: Background now uses `cssVariables.headerBg` instead of hardcoded `bg-card`. Nav link text uses `fontSizeSmall`. Sentiment labels, badges, and tooltips all use admin font sizes/colors. Logo uses `cssVariables.logoOpacity`.
  - **SentinelDashboardPage**: Header uses `cssVariables.headerBg` (was manually constructing hex). "Trading Cards" title uses `fontSizeTitle/textColorTitle`. Username uses `textColorSmall/fontSizeSmall`.
  - **SentinelEvaluatePage**: Header uses `cssVariables.headerBg`. "Ivy AI" title uses `fontSizeTitle`. Ticker name uses `fontSizeHeader/textColorHeader`. Decision gate status uses `fontSizeHeader`. Verdict/Risk Summary labels use `fontSizeTiny/textColorTiny`.
  - **SentinelRulesPage**: Page title, subtitle, all section CardTitles (Base, Custom, AI-Suggested, Community), rule descriptions, and labels all use admin variables.
  - **SentinelImportPage**: Page title, subtitle, all section CardTitles, stats labels, and hint text use admin variables.
  - **WatchlistPage**: Page title, stock count, company name, volume, empty state heading/description all use admin variables.
  - **PatternTrainingPage**: Chart labels, CardTitles (Calculated Data, AI Evaluation, Setup Details, Setup Points), R/R label all use admin variables.
  - **PatternLearningPage**: Page title, subtitle, form labels, setup description all use admin variables.
  - **BigIdeaPage**: Header background, page title, section headers, panel labels all use admin variables.
  - **ScannerPage**: Added `useSystemSettings` import (was missing). Section headers, criteria labels/values/explanations, save dialog title, pagination text all use admin variables.
  - **SymbolPage**: Error heading, company name, stat labels, criteria label all use admin variables.
  - **SentinelTradePage**: Header `bg-card` → `cssVariables.headerBg`. Symbol title, trade detail labels/values, timestamps all use admin variables.
  - **SentinelLoginPage**: Card title, description, form labels, toggle auth link all use admin variables.
  - **Context colors preserved**: All `text-rs-green`, `text-rs-red`, `text-rs-yellow`, `text-rs-amber` semantic signal colors untouched.
- **Status**: Complete

### Admin Font Size Controls + Nav Pane Redesign — 21:25 UTC
- **Task**: Add admin-configurable font sizes per text tier, double nav pane height for company info, move Ivy AI/Watchlist to nav pane, add close button to Charts page
- **Files**: `shared/schema.ts`, `SystemSettingsContext.tsx`, `SentinelAdminPage.tsx`, `DualChartGrid.tsx`, `SentinelChartsPage.tsx`, `server/sentinel/routes.ts`
- **Details**:
  - **Schema**: Added 6 font size columns to `sentinel_system_settings` (fontSizeTitle=1.5rem, fontSizeHeader=1.125rem, fontSizeSection=1rem, fontSizeNormal=0.875rem, fontSizeSmall=0.8125rem, fontSizeTiny=0.75rem)
  - **SystemSettingsContext**: Exposed all 6 font size values in cssVariables object
  - **Admin Panel**: Each text tier row now has a size dropdown (10px-36px) alongside the color picker. "Sample" text renders at both the chosen color AND size for live preview.
  - **Nav Pane doubled**: NAV_INFO_H increased from 38px to 76px. Company name now uses fontSizeHeader (larger), sector/industry on own line with fontSizeSmall, description gets line-clamp-2 with fontSizeTiny.
  - **Ivy AI & Watchlist**: Moved from Charts heading bar into navExtra prop — now renders in the nav pane next to the ticker widget, matching scanner behavior.
  - **Close button**: X button added to Charts page heading bar to clear the active ticker and return to empty state.
  - **Routes**: GET/PATCH system settings endpoints updated to include all 6 font size fields.
- **Status**: Complete

### Charts Page Persistent Heading Bar — 21:05 UTC
- **Task**: Ticker search bar was trapped inside DualChartGrid's optional upperPane — invisible until a ticker was loaded. Moved to a permanent heading row.
- **Files**: `SentinelChartsPage.tsx`
- **Details**:
  - New fixed-height (48px) heading row rendered ABOVE the DualChartGrid, always visible regardless of chart state.
  - Shows: Logo + "Charts" heading (text-rs-header, admin CSS color) + ticker search input + Go button.
  - When a ticker is active, Ivy AI and Watchlist action buttons appear on the right.
  - Removed `upperPane` prop from Charts page — no longer needed since the heading lives outside the grid.
  - Empty state (no ticker) shows a centered placeholder with search icon below the heading.
- **Status**: Complete

### 5-Pane Layout Redesign — Zero Layout Shift — 20:51 UTC
- **Task**: Restructured DualChartGrid into a rigid 5-pane wireframe layout: Upper Pane → Nav+Info row → Charts → Fundamentals → Lower Pane
- **Files**: `DualChartGrid.tsx`, `BigIdeaPage.tsx` (ScanChartViewer), `SentinelChartsPage.tsx`
- **Details**:
  - **Architecture**: Every pane has a fixed pixel height (Upper=40px, Nav+Info=38px, Fundamentals=58px, Lower=24px). Charts row gets ALL remaining height via calculation on mount + ResizeObserver. Zero content-driven resizing.
  - **Nav Pane** (left half): Bloomberg-style price ticker widget. In scanner mode, nav arrows, thumbs up/down, Ivy AI, and Watchlist buttons are appended via `navExtra` prop.
  - **Info Pane** (right half): Company name, sector, industry, and one-line description. Fills in when metrics arrive — the box is already sized.
  - **Upper Pane**: Optional via `upperPane` prop. Standalone Charts page puts the ticker input here. Scanner puts passed-paths badges here.
  - **Lower Pane**: Optional via `lowerPane` prop. Scanner puts a compact horizontal thought breakdown strip here.
  - **Standalone vs Scanner**: Identical component, identical layout. Only difference is which optional props are passed. No `hideTickerStrip` flag needed.
  - **ScanChartViewer simplified**: Header bar, ticker strip, and company info sections removed — all now handled inside DualChartGrid via props. Overlay wrapper is minimal.
- **Status**: Complete

### Fix All Layout Strips — Hardcoded Fixed Heights — 20:22 UTC
- **Task**: Ticker strip and metrics strip were still bouncing/resizing as data loaded at different times
- **Files**: `DualChartGrid.tsx`
- **Details**:
  - **Ticker strip**: Locked to `h-[42px] overflow-hidden` — box is always exactly 42px from first paint. Removed `minHeight`, `flex-wrap`, multi-line company description. Symbol always renders immediately; price/change fill in when data arrives. Company info (name, sector, industry) renders inline on the same line, clipped if too long.
  - **Metrics strip**: Locked outer container to `h-[58px] overflow-hidden` — box is always exactly 58px from first paint. Both bordered grid panels render empty when no data, content fills in when `chartMetrics` arrives. All labels `whitespace-nowrap`, all values `truncate`, inner grids also `overflow-hidden`.
  - **Approach**: Fix the boxes first, then load content into them. No invisible placeholders, no `minHeight` guessing — hardcoded pixel heights with overflow clipping guarantee zero layout shift.
- **Status**: Complete

### Fix Layout Stability & Trend Line Tool — 19:56 UTC
- **Task**: Fixed two major issues: (1) page layout blinking/shifting as data loaded at different intervals, (2) trend line tool drawing partial lines in wrong positions
- **Files**: `DualChartGrid.tsx`, `TradingChart.tsx`
- **Details**:
  - **Layout Stability (DualChartGrid)**:
    - Ticker strip container now always renders with fixed `minHeight: 42px` — shows symbol + "Loading..." placeholder while price data arrives, preventing vertical shift
    - Metrics strip container now always renders with fixed `minHeight: 62px` — shows "Loading fundamentals..." placeholder, preventing bottom-up layout push
    - Removed `dailyData, intradayData` from chart height measurement `useEffect` dependency array — height now measured once on mount + via ResizeObserver, not re-triggered when data loads
  - **Trend Line Tool (TradingChart)**:
    - `createExtendedTrendLine` helper: calculates slope from 2 clicked points, extrapolates to every candle timestamp in the dataset, producing a full edge-to-edge line across the chart
    - Removed aggressive `Math.round(priceFromY * 100) / 100` price rounding — prices now captured at full precision from `coordinateToPrice`
    - Added first-click visual feedback: a dashed price line at the clicked price appears immediately after the first click, removed on second click or mode exit
    - Chart recreation restore now uses the same extended extrapolation for persisted trend lines
- **Status**: Complete

### Fix Overlay Header Layout & Admin CSS Variables — 18:19 UTC
- **Task**: Fixed three layout regressions: (A) X close button position, (B) overlay header needs left/right split, (C) ugly gap from metrics strip skeleton
- **Files**: `BigIdeaPage.tsx`, `DualChartGrid.tsx`
- **Details**:
  - Restructured BigIdea chart overlay header into two halves: left side (nav arrows, ratings, Ivy AI, Watchlist) and right side (ticker strip, company info, X close button) using `justify-between`
  - Added `hideTickerStrip` prop to DualChartGrid so BigIdea renders ticker/company info in its own header instead of above charts — eliminates duplicate rendering
  - Removed `minHeight: 62px` and skeleton placeholders from metrics strip — metrics now only render when data is available, no forced gap
  - Wired admin `cssVariables` (textColorHeader, textColorNormal, textColorSmall, textColorTiny, overlayBg, secondaryOverlayColor) into ticker strip, company info, and all metrics labels — replacing hardcoded Tailwind text classes with `style={{ color: cssVariables.xxx }}`
  - Charts page (SentinelChartsPage) continues to render ticker strip normally via DualChartGrid
- **Status**: Complete

### Fix Trend Line Persistence & Chart Blink — 18:01 UTC
- **Task**: Fixed two chart stability bugs: (1) metrics strip loading caused layout shift that destroyed drawn overlays, (2) multiple trend lines couldn't persist because height changes triggered full chart destruction/recreation
- **Files**: `TradingChart.tsx`, `DualChartGrid.tsx`
- **Details**: Removed `height` from chart creation effect dependency array — height changes now use `chart.applyOptions({ height })` which resizes without destroying the chart. Added `trendLineDataRef` to store trend line data points independently of chart series references, so trend lines are restored after any chart recreation (e.g. data changes). Metrics strip now always reserves space with `minHeight: 62px`, showing a skeleton placeholder while loading to prevent layout shift.
- **Tested**: App compiles without LSP errors; chart height changes no longer destroy drawn trend lines
- **Status**: Complete

### CHANGELOG Timestamp Rule — 18:00 UTC
- **Task**: Added HH:MM UTC timestamps to all changelog section headers and updated project rules
- **Files**: `CHANGELOG.md`, `replit.md`
- **Details**: Every changelog entry now includes `— HH:MM UTC` in the section header. Retroactively added timestamps to existing 2026-02-13 entries. Updated replit.md Changelog rule to enforce this going forward.
- **Status**: Complete

### Ticker/Price Strip & Company Info Moved Into DualChartGrid — 17:52 UTC
- **Task**: Moved Bloomberg-style ticker strip (symbol | price | change | %) and company info (name, sector/industry, description) from page-level headers into DualChartGrid, rendering above both charts as a full-width banner
- **Files**: `DualChartGrid.tsx`, `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Details**: DualChartGrid now accepts `symbol` prop and internally computes dayChange from dailyData. Company description enlarged from `text-[10px] line-clamp-2 max-w-[500px]` to `text-xs line-clamp-3 max-w-[700px]`. Sector/industry label bumped from `text-xs` to `text-sm`. Applies uniformly across all chart viewers (Charts page, BigIdea scanner, Trading Card).
- **Tested**: App compiles and runs; removed ~80 lines of duplicate ticker/company rendering from both pages
- **Status**: Complete

### DualChartGrid Component Extraction — 17:00 UTC
- **Task**: Extracted shared dual-chart layout (Daily + Intraday) into a reusable `DualChartGrid` component, eliminating ~400 lines of duplicate code across BigIdeaPage and SentinelChartsPage
- **Files**: `DualChartGrid.tsx` (new), `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Details**: DualChartGrid encapsulates chart headers/toolbars (measure, trend line, ETH toggle), RTH filtering, resize handling, MA settings dialog, metrics strips, loading/empty states. Scanner-specific features (CoC markers, diamond markers, price lines, resistance lines) passed via `dailyChartProps`. Exports shared `ChartMetrics` and `ChartDataResponse` types.
- **Tested**: App compiles and runs without errors; both chart viewers render identically to pre-refactor
- **Status**: Complete

### Chart Header Overlay Unification — 16:30 UTC
- **Task**: Changed Daily/Intraday header bars from `secondaryOverlayColor` (light gray) to `overlayBg` (admin-configurable primary overlay) with white text
- **Files**: `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`
- **Tested**: Visual — headers now use coordinated dark overlay background on both pages
- **Status**: Complete

### Company Metadata on Chart Viewers — 15:45 UTC
- **Task**: Added company name, sector/industry, and company description near ticker symbol display in both BigIdea chart viewer and standalone Charts page
- **Files**: `BigIdeaPage.tsx`, `SentinelChartsPage.tsx`, `server/sentinel/routes.ts`
- **Details**: Fetches Tiingo ticker meta (name, description) and sector/industry info. Description shown as 2-line truncated text with hover for full text.
- **Tested**: Verified API response includes `companyName`, `companyDescription`, `sectorName`
- **Status**: Complete

### Dashboard Trade Card Icon Sizing — 14:30 UTC
- **Task**: Enlarged Evaluate (MessageSquare) and Chart (BarChart3) action icons from 3.5x3.5 to 5x5, buttons from h-7 w-7 to default `size="icon"` (h-9 w-9)
- **Files**: `SentinelDashboardPage.tsx`
- **Tested**: Visual confirmation icons are larger and more clickable
- **Status**: Complete

### Hide Watch Quantity Display — 13:45 UTC
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
