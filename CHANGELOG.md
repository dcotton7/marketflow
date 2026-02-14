# Change Log

All completed development tasks, fixes, and features are tracked here with dates, timestamps, descriptions, and test status. Every entry includes a timestamp in HH:MM UTC format.

---

## 2026-02-14

### Fix PA-3 / CB-1 Base Overlap in Chained Scans — 16:55 UTC
- **Task**: Prevent overlapping base detection when PA-3 (Current Coiling Base) is chained downstream from CB-1 (Find Base Historical) in scans like "Test Dual Base".
- **Files**: `server/bigidea/indicators.ts`
- **Details**:
  - **Root cause**: PA-3 had no `consumes` declaration and didn't accept `upstreamData`, so it was completely unaware of any historical base found by CB-1 upstream. Both indicators could detect bases in the same bar range.
  - **Fix**: Added `consumes: [{ paramName: "maxBaseLimit", dataKey: "baseEndBar" }]` to PA-3 so it receives CB-1's `baseEndBar` (the newest bar of the historical base). PA-3 now caps its max search length to `baseEndBar`, ensuring it only looks for bases in bars BEFORE the historical base starts.
  - If the historical base is too close to the current bar (not enough room for a min-length base), PA-3 returns a clear diagnostic: "upstream base too close".
  - Updated PA-3 description to note anti-overlap behavior when connected downstream from CB-1.
- **Status**: Complete

### Collapse All Button for Thought Library — 16:50 UTC
- **Task**: Add a "Collapse All / Expand All" toggle button to the Thought Library panel header.
- **Files**: `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - Added a `ChevronsDownUp` / `ChevronsUpDown` icon button next to the "Thought Library" header.
  - Click toggles between collapsing all categories and expanding all categories.
  - Includes tooltip ("Collapse all categories" / "Expand all categories").
  - Only shows when thoughts exist.
- **Status**: Complete

### Copy Debug Button Visibility Improvement — 16:50 UTC
- **Task**: Make the clipboard copy button in the Scan Debug panel easier to find.
- **Files**: `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - Increased button size from h-5 w-5 to h-6 w-6, icon from h-3 w-3 to h-3.5 w-3.5.
  - Added tooltip ("Copy debug info to clipboard") so users can discover the button.
- **Status**: Complete

### Fix Backfill for Production Data — 16:52 UTC
- **Task**: Fix thought score backfill to work with production data where `idea_id` is NULL and config nodes lack `thoughtId`.
- **Files**: `server/bigidea/routes.ts`
- **Details**:
  - **Root cause**: Backfill skipped all 105 chart ratings because `if (!r.ideaId) continue`. Scan sessions filtered on `n.thoughtId` which doesn't exist on production config nodes (they use `thoughtName` instead).
  - **Fix**: Created `resolveThoughtIdsFromNodes()` helper that first tries `thoughtId` (numeric), then falls back to matching `thoughtName` against the `scanner_thoughts` table by name (case-insensitive).
  - For chart ratings: first tries `ideaId` → idea's nodes, then falls back to `sessionId` → session's `scan_config.nodes`. Only skips truly orphan ratings with neither link.
  - Pre-fetches all thoughts once into a name→id map for efficient lookups.
  - 87 of 105 chart ratings now have a valid `sessionId` path; 18 remain orphaned.
- **Status**: Complete

### Score Counters on AI Score Weighting Tab — 16:53 UTC
- **Task**: Add score event counters (Scored Thoughts, Scans Today, Ratings Today, All Time Events) to the AI Score Weighting admin tab.
- **Files**: `server/bigidea/routes.ts`, `client/src/pages/SentinelAdminPage.tsx`
- **Details**:
  - Added `GET /api/bigidea/thought-scores/stats` endpoint returning thought stats (total, scored, totalPoints), session counts (allTime, today, thisWeek), and rating counts (allTime, today, thisWeek).
  - Added a 4-card stats grid at the top of the AI Scoring tab showing: Scored Thoughts (X/total, Y pts), Scans Today (+ this week), Ratings Today (+ this week), All Time Events (scans + ratings combined).
  - Stats auto-refresh after backfill completes.
- **Status**: Complete

### Scan Performance Optimization — 09:00 UTC
- **Task**: Speed up BigIdea scan execution by increasing parallelism, implementing lazy data fetching, and adding database indexes.
- **Files**: `server/bigidea/routes.ts`, database DDL
- **Details**:
  - **Batch size**: Increased scan batch size from 10 to 25 concurrent tickers. Tiingo Business tier supports high concurrency, and 10 was overly conservative.
  - **Lazy timeframe fetching**: Candle data for each timeframe (daily, weekly, intraday) is now fetched on-demand when a thought node first needs it, instead of fetching all timeframes upfront for every ticker. If a ticker fails early on a "daily" criterion, we never fetch its "weekly" data — saving API calls and latency.
  - **Database indexes**: Added 7 missing indexes across scan tables for future query performance as tables grow:
    - `scan_chart_ratings`: `user_id`, `(user_id, idea_id)`
    - `scan_tuning_history`: `outcome`, `session_id`, `(outcome, admin_approved)`
    - `scan_sessions`: `idea_id`, `(user_id, idea_id)`
- **Status**: Complete

### Fix Overlapping Bases in Find Base (Historical) Chaining — 08:30 UTC
- **Task**: Fix overlapping base highlights when chaining multiple Find Base (Historical) indicators to detect sequential base patterns (e.g., historical base → price advance → current base).
- **Files**: `server/bigidea/indicators.ts`
- **Details**:
  - **Root cause**: Find Base (Historical) consumed `baseEndBar` from upstream, which is the MORE RECENT end of the upstream base. This caused the downstream search to start INSIDE the upstream base's bar range, producing overlapping base highlights.
  - **Fix**: Changed `consumes` from `{ dataKey: "baseEndBar" }` to `{ dataKey: "baseStartBar" }` so the downstream search begins at the OLDER end of the upstream base. Added +1 offset (`upstreamStartBar + 1`) in the evaluate function to ensure zero overlap at the boundary.
  - Updated the evaluate function's data reference from `upstreamData?.baseEndBar` to `upstreamData?.baseStartBar` to match.
  - Updated indicator description to clarify it starts searching "PAST the upstream base's oldest bar."
- **Status**: Complete

### Scan Debug Copy Button — 08:25 UTC
- **Task**: Add a clipboard copy icon to the Scan Debug panel header so users can copy all debug info as formatted text.
- **Files**: `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - Added `ClipboardCopy` icon button next to "Scan Debug" header text.
  - Click formats all debug sections into clean multi-line text: timestamp/duration/universe, result count, eval order, thought stems, auto-linked params, dynamic data flows, and per-thought criteria breakdowns with params.
  - Uses `navigator.clipboard.writeText()` with toast confirmation.
- **Status**: Complete

### AI Scan Tuning: Add/Remove Criterion Suggestions — 08:15 UTC
- **Task**: Expand AI scan tuning to support adding new criteria and removing existing criteria, not just parameter adjustments.
- **Files**: `server/bigidea/routes.ts`, `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - **Backend**: System prompt updated with 3 suggestion types: `param_change` (existing), `add_criterion` (new), `remove_criterion` (new). User message now includes thought node summary (nodeId, name, criteria) and available indicator library (indicators not on canvas). Server-side validation/filtering handles all 3 types with proper bounds checking, criterion construction from INDICATOR_LIBRARY defaults, and auto-detection of target thought nodes. Max completion tokens increased to 2500.
  - **Frontend Accept/Undo**: `handleAcceptSuggestion` handles all 3 types — param_change updates param values, add_criterion appends criterion to target thought, remove_criterion filters it out (capturing the removed criterion for undo). `handleUndoSuggestion` reverses each type correctly.
  - **Frontend UI**: Suggestion cards render conditionally based on type — param_change shows current→suggested value with strikethrough, add_criterion shows green Plus icon with "Add criterion" label, remove_criterion shows red Minus icon with "Remove criterion" label. All types share the same Apply/Undo button pattern.
  - **TuningSuggestion type**: Already extended with `type`, `thoughtId`, and `criterion` optional fields.
- **Status**: Complete

### Thought Library Preview Feature — 08:00 UTC
- **Task**: Clicking a thought in the library panel shows a read-only preview in the right pane with greyed-out controls.
- **Files**: `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - Clicking a library thought sets `previewThought` state showing the thought's criteria in the right pane at 70% opacity.
  - Sliders disabled with `pointer-events-none`, values shown as Badges instead of interactive controls.
  - "Drag onto canvas to adjust parameters" message displayed.
- **Status**: Complete

### Fix Chart Blink on Scanner Arrow Navigation — 07:45 UTC
- **Task**: Eliminate the visual flash/blink when navigating between scanner results using arrow keys or prev/next buttons in the scan chart viewer.
- **Files**: `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - Removed dynamic `key` prop (`key={currentIndex-symbol}`) from `ChartErrorBoundary` that was forcing a full remount of DualChartGrid on every navigation. Replaced with a stable key.
  - Added `placeholderData: (prev) => prev` to both daily and intraday chart data queries so the previous chart remains visible while the new ticker's data loads, preventing a flash to loading state.
- **Status**: Complete

### Measure & Drawing Tools Made Mutually Exclusive — 07:40 UTC
- **Task**: Make the measure tool (ruler) and drawing tools (trend line, horizontal line) mutually exclusive — activating one deactivates the other.
- **Files**: `client/src/components/DualChartGrid.tsx`
- **Details**:
  - Daily toolbar: Clicking the measure button now clears any active drawing tool (`dailyDrawings.setActiveTool(null)`). Clicking either drawing tool now turns off measure mode (`setDailyMeasureMode(false)`).
  - Intraday toolbar: Same mutual exclusion pattern applied — measure clears drawing tools, drawing tools clear measure mode.
- **Status**: Complete

### Fix AI Idea Creation Timeframe Detection — 07:30 UTC
- **Task**: Fix the AI "Create New Idea" prompt so it correctly detects intraday timeframe references (e.g., "5-min", "15-minute") from combined descriptions and sets the thought-level timeframe accordingly instead of always defaulting to "daily".
- **Files**: `server/bigidea/routes.ts`
- **Details**:
  - Added "THOUGHT TIMEFRAME DETECTION — CRITICAL" block to the AI system prompt listing all valid timeframe values ("daily", "5min", "15min", "30min") with explicit mapping rules for common user phrases ("5-min" → "5min", "15-minute" → "15min", etc.).
  - Instructs the AI to split multi-timeframe combined descriptions into separate thoughts with correct timeframes on each.
  - Fixed multi-timeframe examples in the prompt to use actual valid values ("5min") instead of the invalid "intraday" placeholder.
- **Status**: Complete

### Professional Chart Drawing Tools — 07:17 UTC
- **Task**: Implement persistent drawing tools (trend lines, horizontal lines) for the dual chart grid with full PostgreSQL storage, drag/move, and delete functionality.
- **Files**: `shared/schema.ts`, `server/routes.ts`, `client/src/lib/chartDrawingPrimitives.ts`, `client/src/hooks/useChartDrawings.ts`, `client/src/components/TradingChart.tsx`, `client/src/components/DualChartGrid.tsx`
- **Details**:
  - **Database schema**: Added `chart_drawings` table with userId, ticker, timeframe, toolType, points (JSONB), styling (JSONB) columns. Full CRUD API routes (GET/POST/PUT/DELETE) with per-user scoping.
  - **Drawing primitives**: Built `TrendLinePrimitive` and `HorizontalLinePrimitive` as lightweight-charts v5 series primitives following the existing MeasurePrimitive pattern. Features include HiDPI-aware rendering via `useBitmapCoordinateSpace`, drag handles (circles at endpoints), selection highlighting, and proper `attached()/detached()/paneViews()` lifecycle.
  - **Hit detection**: `hitTestDrawings()` function with 8px grab radius on handles and line projection for selection. Returns which handle (p1/p2/line) was hit for drag differentiation.
  - **useChartDrawings hook**: Full drawing state machine (idle/drawing/dragging modes). Loads drawings from API per ticker+timeframe, click-to-place for both tool types (2-click for trend lines, 1-click for horizontal lines), drag endpoints or entire trend lines, 300ms debounced saves on drag, Delete/Backspace to remove selected drawing, Escape to cancel.
  - **TradingChart integration**: Added new props (`drawingToolActive`, `onChartReady`, `onChartClick`, `onChartMouseDown`, `onChartCrosshairMove`, `onChartMouseUp`) for external drawing control. Forward all events through refs to avoid stale closures. Crosshair cursor when drawing tool is active. Removed old broken LineSeries-based trend line code (`createExtendedTrendLine`, `trendLineDataRef`, `trendLineSeriesListRef`, etc.).
  - **DualChartGrid toolbar**: Replaced old trend line toggle with proper drawing tool buttons — Trend Line (diagonal icon), Horizontal Line (minus icon), and Clear All (trash icon, shown only when drawings exist). Both daily and intraday charts have independent drawing instances. Integrated `useChartDrawings` hook for each chart pane.
- **Status**: Complete

### CB-1 Find Base Indicator — Chart Rendering & AI Integration — 14:00 UTC
- **Task**: Complete the CB-1 Find Base indicator by adding chart annotations, category support, and AI prompt awareness.
- **Files**: `server/bigidea/routes.ts`, `client/src/pages/BigIdeaPage.tsx`, `server/bigidea/indicators.ts`
- **Details**:
  - **cocHighlight2 support**: Added `cocHighlight2` property to `CriterionResult` types (both server and client) so Find Base can render both resistance (top) and support (bottom) price lines on charts.
  - **Route extraction**: Updated `evaluateThought` to extract `_cocHighlight2` from indicator output data and include it in criteria results.
  - **Chart annotations**: BigIdeaPage now processes `cocHighlight2` support lines from CB-1 results, pushing them into the resistance lines array for chart rendering.
  - **Category support**: Added "Consolidation" to `CATEGORY_ORDER` and `CATEGORY_ICONS` (using Layers icon) in BigIdeaPage.
  - **Base filter**: Updated `ideaHasBase` check and annotation filter to include CB-1 alongside PA-3/PA-4.
  - **AI prompt**: Updated AI scan tuning prompts with CB-1 data-linking relationships (provides baseStartBar/baseEndBar/baseTopPrice/baseLowPrice, supports chaining). Added "Consolidation" to the AI thought category list.
- **Status**: Complete

### Fix Admin Check on Score/Weight Routes — 05:52 UTC
- **Task**: Fix 403 "Admin only" error when editing AI score rules and selection weights.
- **Files**: `server/bigidea/routes.ts`
- **Details**:
  - Three admin-only endpoints (PUT score-rules, PUT selection-weights, POST backfill) were checking only `tier === "admin"` but not the `isAdmin` flag. Updated all three to use `(tier !== "admin" && !isAdmin)`, consistent with other admin checks throughout the codebase.
- **Status**: Complete

### Standardize Top Menu Bar & BigIdea Toolbar Fix — 05:49 UTC
- **Task**: Standardize top navigation bar across all pages to match BigIdea pattern, fix BigIdea toolbar order, fix admin tier issue.
- **Files**: `client/src/components/SentinelHeader.tsx`, `client/src/pages/SentinelDashboardPage.tsx`, `client/src/pages/SentinelTradePage.tsx`, `client/src/pages/SentinelChartsPage.tsx`, `client/src/pages/SentinelEvaluatePage.tsx`, `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - **SentinelHeader**: Added `rightContent` prop for page-specific right-side elements (logout, back buttons) rendered inside the standard header layout.
  - **Dashboard**: Removed extra `<header>` wrapper. Logout/username now passed as `rightContent` to SentinelHeader.
  - **Trade Page**: Removed extra `<header>` wrapper. Trade info (symbol, badges, actions) moved to a sub-toolbar below the standard SentinelHeader, matching BigIdea's toolbar pattern.
  - **Charts Page**: Removed duplicate logo and "Charts" title from the sub-toolbar. Ticker input and controls remain as a clean sub-toolbar row.
  - **Evaluate Page**: Removed extra `<header>` wrapper. Back button passed as `rightContent` to SentinelHeader.
  - **BigIdea Toolbar**: Swapped "List" dropdown to appear after the Index/Solution selector (user request).
  - **Admin Tier**: Fixed Foreboding user tier from "standard" to "admin" so admin weight editing works.
- **Status**: Complete

### BigIdea Thought Scoring & AI Selection System — 06:30 UTC
- **Task**: Implement a thought scoring system and AI-weighted selection for the BigIdea scan builder.
- **Files**: `shared/schema.ts`, `server/bigidea/routes.ts`, `client/src/pages/BigIdeaPage.tsx`, `client/src/pages/SentinelAdminPage.tsx`
- **Details**:
  - **Schema**: Added `score` (int, default 0) and `lastUsedAt` (timestamp) to `scanner_thoughts`. Created `thought_score_rules` table (ruleKey, label, description, scoreValue, enabled) with 4 seeded defaults. Created `thought_selection_weights` table (strategyKey, label, description, weightPercent, configN, enabled) with 3 seeded defaults (30% pure random, 33% top-N random, 34% highest rated).
  - **Scoring Rules (admin-configurable)**: Rule 1 — modified thoughts get +3 on idea save (server-side criteria comparison). Rule 2 — non-muted thoughts get +1 when scan returns results. Rule 3 — non-muted thoughts get +1/-1 on chart thumbs-up/down.
  - **Admin UI**: New "AI Score Weighting" sub-tab in TNN admin page with editable Scoring Rules table and Selection Weights table. Weight total shown with green/amber color. Retroactive "Backfill Scores" button to apply current rules to existing chart_ratings and scan_sessions.
  - **Thought Library**: Categories are now collapsible with chevron arrows and item counts. Thoughts sorted by score descending. Score badges displayed next to thought names with context colors (negative=red, 0-20=white, 21-100=yellow, 100+=green).
  - **AI Selection**: Weighted random selection endpoint (`GET /api/bigidea/thoughts/ai-selection`) reads configurable weights from DB. Three strategies: pure random, random from top N scored, highest rated. Prevents convergence on single thought. AI idea generator now checks existing thoughts and reuses highly-rated ones when they closely match (same indicators/params/purpose), creating new thoughts only when no close match exists. Reused thoughts show a "Reusing existing" badge in the proposal dialog.
  - **Backfill**: Admin endpoint processes historical chart_ratings and scan_sessions to retroactively score thoughts.
- **Status**: Complete

### BigIdea Toolbar Reorder & Quality Rating Overlay — 05:10 UTC
- **Task**: Reorder BigIdea toolbar, add ellipsis dropdown menu, move scan quality rating from left sidebar into a styled overlay dialog.
- **Files**: `client/src/pages/BigIdeaPage.tsx`
- **Details**:
  - **Toolbar reorder**: New order is Idea Name → List (load dropdown, always visible) → Universe → Run Scan → Save Idea → Clear → Tune → Ellipsis ("...") dropdown button.
  - **Ellipsis dropdown**: New `MoreHorizontal` icon button (same height as other toolbar buttons) opens a DropdownMenu with "Rate Quality" (shows current grade if available) and conditionally "Save & Commit Tuning" (only visible when tuning is dirty).
  - **Quality overlay**: Removed the collapsible scan quality panel from the bottom of the left sidebar. Quality results now display in a full Dialog overlay styled with sysadmin colors (`overlayBg` background, `secondaryOverlayColor` border). Shows overall grade, score, and all 5 dimensions with details and suggestions. Only action is [Close] which returns to scan setup.
  - **Repeatable rating**: User can press "Rate Quality" from the ellipsis menu as often as they like. Each press triggers a fresh API call and opens the overlay with updated results reflecting any changes made to the idea.
- **Status**: Complete

### Fix Fundamentals Strip Clipping — 04:45 UTC
- **Task**: Fundamentals values (PE, Pre-Tax Margin, Debt/Equity, Target Price, etc.) were invisible because the fixed pane height was too short and `overflow-hidden` clipped the second row of values.
- **Files**: `client/src/components/DualChartGrid.tsx`
- **Details**: Increased `FUND_H` from 58px to 70px. The two-row grid (labels at 10px + values at 12px, with padding and gap) needs ~66px minimum; 58px was 8px too short, cutting off all bottom-row values.
- **Status**: Complete

## 2026-02-13

### Fix All Fundamental & Technical Data (FMP API) — 21:50 UTC
- **Task**: Fix all fundamental data fields that were returning "N/A" due to incorrect or broken FMP API calls.
- **Files**: `server/fundamentals.ts`
- **Details**:
  - **PE Ratio**: Profile endpoint doesn't return `pe` on free tier. Switched to `/stable/ratios-ttm` endpoint which provides `priceToEarningsRatioTTM`. Now returns real PE (e.g., AAPL: 32.03, NVDA: 44.82).
  - **Debt/Equity**: `debtToEquityTTM` field didn't exist in `key-metrics-ttm`. Switched to `ratios-ttm` which provides `debtToEquityRatioTTM`. Now returns real D/E (e.g., AAPL: 1.03, NVDA: 0.09).
  - **Pre-Tax Margin**: `netProfitMarginTTM` field didn't exist in `key-metrics-ttm`. Switched to `ratios-ttm` which provides `pretaxProfitMarginTTM`. Now returns real margin (e.g., AAPL: 32.4%, NVDA: 62.1%).
  - **Target Price**: Was always null because analyst-estimates endpoint was broken. Added new `fetchPriceTargetConsensus()` using `/stable/price-target-consensus` endpoint which returns real consensus target (e.g., AAPL: $303.11, NVDA: $267).
  - **Analyst Consensus**: Was "N/A" because `/analyst-estimates` required `period` param. Now derived from price target consensus data (Buy/Hold based on consensus vs midpoint of high/low range).
  - **Next Earnings Date**: Was "N/A" because `/earning-calendar?symbol=X` returned empty. Now estimated by adding 3 months to last income statement date, with while-loop to advance past today if the projected date already passed.
  - **EPS Current Q YoY**: Was always "N/A". Now computed from quarterly income statements (`/stable/income-statement?period=quarter&limit=5`), comparing current quarter's `epsDiluted` to same quarter last year (e.g., AAPL: +18%, NVDA: +67%).
  - **Sales Growth 3Q YoY**: Was always "N/A". Now computed from quarterly revenue data — sum of 3 most recent quarters vs prior 3 quarters (e.g., AAPL: +8%, NVDA: +25%).
  - **Last EPS Surprise**: Was always "N/A" (quarterly analyst estimates require premium FMP). Now uses annual analyst estimates (`/stable/analyst-estimates?period=annual`) — compares trailing 4-quarter actual EPS to annual estimate EPS (e.g., AAPL: +$0.53 (+7%), MSFT: +$2.57 (+19%)).
  - **ADR (Average Daily Range)**: Was already working correctly. Confirmed ADR20 $ and ADR20 % compute properly (e.g., AAPL: $6.28 / 2.4%).
  - **Beta**: Was already working from profile endpoint. Confirmed (e.g., AAPL: 1.107, NVDA: 2.314).
- **Status**: Complete

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
