# AI Swing Scanner & Sentinel

## Overview
This project consists of two core applications: **AI Swing Scanner** and **Sentinel**. The **AI Swing Scanner** is a stock market analysis tool designed to identify technical patterns and provide real-time data with detailed charts. **Sentinel** is a multi-user web application leveraging advanced AI (OpenAI's gpt-5.1/5.2) to evaluate user-submitted trade ideas, enforce trading discipline through personal rules, and track performance. Sentinel's primary focus is on process improvement in trading rather than generating trade signals. The overarching vision is to provide comprehensive tools for traders to analyze markets, refine their strategies, and improve discipline, ultimately enhancing their trading performance and fostering continuous learning.

## User Preferences
Preferred communication style: Simple, everyday language.
Preferred test username: Foreboding
Debugging rule: ALWAYS query the PRODUCTION database when investigating user-reported issues. Never use the development database for troubleshooting live app problems.

## System Architecture

### UI/UX Decisions
Both applications feature a dark-themed financial dashboard. The AI Swing Scanner presents a dual-chart layout with fixed and variable timeframes, visualizing specific patterns (Cup and Handle, VCP, High Tight Flag) using distinct color schemes. Sentinel offers a clean dashboard with trade status tabs, an asynchronous ticker lookup in its evaluation form, and comprehensive input fields for trade parameters. Customization options include overlay color, transparency, background color, and logo transparency, managed via a SystemSettingsProvider.

### Technical Implementations
**AI Swing Scanner**: Features multi-timeframe charts, various SMA indicators, VWAP, pattern-specific drawing tools, and a scanner with filters for indices, candlestick patterns, chart patterns, and technical indicators. It also displays ETFs and related stocks.

**Sentinel**: Implements session-based authentication using PostgreSQL. It uses OpenAI's `gpt-5.1` for standard trade evaluations and `gpt-5.2` for "deep evaluations," generating structured outputs that include a decision gate (status, score, confidence), model tag detection, plan summary, "Why This Could Work" points, risk flags, and rule adherence checklists. Trade submission supports dynamic ticker lookup, flexible stop/target definitions, and position sizing. API endpoints manage user authentication, trade submission, status updates, and data retrieval, with a technical data fetcher providing market context for AI evaluations.

### System Design Choices
The project utilizes a monorepo structure, separating a React frontend from an Express backend. Shared definitions, such as Zod schemas for API contracts and Drizzle schemas for the database, ensure consistency. React Query manages server state and caching, while Drizzle ORM provides type-safe PostgreSQL interactions.

The system incorporates an **AI Collective Learning** mechanism where trading rules are sourced from 'starter', 'user', 'ai_collective', and 'ai_agentic' categories. Rule performance is tracked across users, and an AI endpoint (gpt-4o) analyzes patterns to suggest new rules. A **Market Sentiment Engine** gauges sentiment through trends in major indices, risk baskets, sector trends, and the Choppiness Index, influencing AI scoring and displayed in the UI.

A robust **Trade Import System** supports multi-broker CSV imports (e.g., Fidelity, Schwab, Robinhood) with features like preview-before-confirm, auto-broker detection, partial fill detection, and smart orphan sell detection with a review flow. **Incremental Merge Promotion** tracks which imported trades have already been promoted (`promoted_to_card_id` + `promoted_at` fields on `sentinel_imported_trades`). When existing import cards exist, a "Merge New Trades" button only processes un-promoted trades and appends their lots to existing active cards or creates new cards, without deleting existing cards/evaluations/events/labels/order levels. A "Re-promote (Clean)" option is still available for full rebuilds. An `/api/sentinel/import/unpromoted-stats` endpoint provides counts for the UI. Orphan resolution is managed through a dedicated **Orphans tab** (5th tab on the Import page) providing a global cross-batch view with ticker search, sort by trade date/import date/ticker, status filters (all/pending/resolved/muted), inline cost basis and open date editing, and individual resolve/mute/delete actions. The `/api/sentinel/import/all-orphans?includeResolved=true` endpoint returns all orphan statuses. Duplicate detection and resolution are integrated into the import workflow, requiring resolution before trade promotion.

**Order Levels Management** supports multiple stop loss and profit target orders per trade, displayed on trade cards with proximity alerts. Expandable mini-grids allow inline adding and deleting of order levels, and a system-derived partial profit level is shown. An "Orders Import" tab processes Fidelity Orders CSV files, parsing and importing stop loss/limit orders with duplicate detection and filtering of irrelevant order statuses.

The **Pattern Training Tool** is an interactive chart-based system for users to annotate stock setups, building a personal pattern library. Users mark key points on charts (Entry, Stop, Target, Sell, Support/Resistance, Breakout/Breakdown), and the system captures over 40 technical indicators at each point. "Sell" is distinct from "Stop" (Stop = planned risk level, Sell = actual exit lot from imports). Point roles support 1-to-many: multiple Entries, Stops, Targets, and Sells per setup. This tool includes an engine for data fetching and indicator calculation, a lightweight-charts based UI, and database storage for setups and points. A **modular TradingChart component** (`client/src/components/TradingChart.tsx`) accepts data via props (candles, indicators, markers, price lines, click handlers, maSettings) and is shared between Pattern Training and Trading Card position views. It supports an optional `maSettings` prop (fetched from `/api/sentinel/ma-settings`) that overrides the default MA colors, line styles, visibility, and per-timeframe on/off toggles. System MA row IDs map to indicator fields: sys_sma5→ema5, sys_sma10→ema10, sys_sma20→sma21, sys_sma50→sma50, sys_sma200→sma200, sys_vwap_hi→avwapHigh, sys_vwap_lo→avwapLow. The legend dynamically adapts to reflect user settings. A gear icon (Settings2) in both the Trade Chart Dialog header and Pattern Training toolbar opens the MaSettingsDialog (`client/src/components/MaSettingsDialog.tsx`). A **dual-chart layout** shows a fixed daily chart on the left and a switchable intraday chart (5m/15m/30m) on the right, both rendering shared annotation points. Tiingo IEX intraday data goes back to 2017 (no short lookback limits); intraday timestamps preserve full datetime (not date-only) to prevent duplicate keys. An **AI Setup Evaluation** feature (gpt-5.1) scores annotated setups 1-10 with verdict, strengths, weaknesses, risk flags, and suggestions. It includes a learning layer that queries historical setups with outcomes, computes aggregate pattern stats (win rate, avg R/R by pattern type), and finds similar past setups for personalized evaluation. Evaluations are stored in `pattern_training_evaluations` and displayed inline below the calculated metrics section.

**Trading Card Chart View**: A "Show Chart" dialog opens from trade card menus, displaying the position's ticker in a dual-chart layout with horizontal price lines for avg entry, avg exit, stop, target, and order levels. Supports **click-to-refine-time**: users select a lot entry from the list below the charts (showing pinned/unpinned status), then click an intraday chart bar to pin the exact execution time via `PATCH /api/sentinel/trades/:tradeId/refine-lot-time`.

**Position Splitting Rule**: During trade import promotion (`/api/sentinel/import/promote-to-cards`), all buys/sells on the same calendar day belong to the same position. A position only closes when end-of-day share count hits zero. Next day's buy opens a new Trading Card. FIFO matching tracks realized P&L per position accurately.

Admin features include **User Management**, allowing administrators to list users, track rule counts, and provision starter rules, and an **Admin-only Trader Neural Network (TNN)**, a three-layer adaptive factor weighting system where AI learns from trade outcomes to adjust weights for discipline factors, setup types, and contextual modifiers.

## External Dependencies

### Database
- **PostgreSQL**: Primary database, managed with Drizzle ORM.

### Market Data API
- **Tiingo API** (Business tier): Centralized data provider via `server/tiingo.ts`. Provides EOD daily/weekly/monthly prices (5+ years history), IEX intraday data (back to 2017), real-time quotes, and ticker metadata. All market data flows through this single module. Note: Tiingo does not provide sector, industry, market cap, PE ratio, or earnings data — sector/industry uses pre-computed local lookups via `STOCKS_BY_SECTOR`.

### Fundamentals Data
- **Financial Modeling Prep (FMP) API** (free tier, 250 req/day): Fallback fundamentals provider via `server/fundamentals.ts` using stable endpoint (`https://financialmodelingprep.com/stable/profile?symbol=X`). Two-tier lookup: local `STOCKS_BY_SECTOR` table first (~120 stocks, instant), FMP API fallback for unknown tickers. 24-hour in-memory cache + deduplication of concurrent requests to conserve API quota. Provides sector, industry, and market cap for tickers not in the local table.

### AI Services
- **OpenAI API**: Used by Sentinel for trade evaluation with `gpt-5.1`, `gpt-5.2`, and `gpt-4o` models.

### UI/Styling
- **Google Fonts**: Inter and JetBrains Mono.
- **Lucide React**: Icon library.