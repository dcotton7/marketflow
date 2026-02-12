# AI Swing Scanner & Sentinel

## Overview
This project comprises two main applications: **AI Swing Scanner** and **Sentinel**. The **AI Swing Scanner** is a stock market analysis tool designed to identify technical patterns and provide real-time data with charts. **Sentinel** is a multi-user web application that uses advanced AI to evaluate user-submitted trade ideas, enforce trading discipline through personal rules, and track performance. Its primary goal is to improve trading processes rather than generate trade signals. The overall vision is to equip traders with comprehensive tools for market analysis, strategy refinement, and discipline enhancement, ultimately improving their trading performance and fostering continuous learning.

## User Preferences
Preferred communication style: Simple, everyday language.
Preferred test username: Foreboding
Debugging rule: ALWAYS query the PRODUCTION database when investigating user-reported issues. Never use the development database for troubleshooting live app problems.
UI rule: ALWAYS add clear ? tooltip help text to every new UI element (sliders, inputs, toggles, buttons). Use the existing PARAM_DESCRIPTIONS pattern in BigIdeaPage.tsx for indicator params. Never skip this step.

## UI Rubric

### Context Color Key
Non-context text is WHITE (default foreground).

| Color   | CSS Class          | Meaning                                                                 |
|---------|--------------------|-------------------------------------------------------------------------|
| Green   | `text-rs-green`    | Go / Good / Entry Point — recommended excellent path                    |
| Yellow  | `text-rs-yellow`   | Moderate Caution — medium-important info                                |
| Amber   | `text-rs-amber`    | Caution — TP levels, questionable entries, worrisome resistance          |
| Red     | `text-rs-red`      | Warning / Extreme Caution — Do Not Do, also stop prices                 |

Section headers follow the context color of the section they belong to (e.g. a caution section header uses amber).

### Text Size Hierarchy
All text defaults to WHITE unless context-colored per the table above.

| Tier           | CSS Class       | Usage                                                    | Default Color       |
|----------------|-----------------|----------------------------------------------------------|---------------------|
| Title          | `text-rs-title` | Largest size, page titles                                | White (foreground)  |
| Header         | `text-rs-header`| Page headers, major section labels                       | White (foreground)  |
| Section Header | `text-rs-section`| Sub-sections like "Trade Snapshot" on AI results        | White (foreground), can be context-colored |
| Normal         | `text-rs-normal`| Standard reading text                                    | White (foreground)  |
| Small          | `text-rs-small` | Less important but visible supplementary info            | Lighter white (muted-foreground) |
| Tiny           | `text-rs-tiny`  | Debug info, timestamps, least important                  | Lighter white (muted-foreground) |

### Bloomberg Ticker
Standard ticker display: Symbol in mono font, price, and percentage change (green up / red down).
CSS class: `rs-ticker` for the container, uses mono font with context-colored price change.

## System Architecture

### UI/UX Decisions
Both applications feature a dark-themed financial dashboard. The AI Swing Scanner utilizes a dual-chart layout with fixed and variable timeframes, visualizing patterns like Cup and Handle, VCP, and High Tight Flag with distinct color schemes. Sentinel provides a clean dashboard with trade status tabs, asynchronous ticker lookup, and comprehensive input fields for trade parameters. Customization options for overlay, background, and logo transparency are managed via a SystemSettingsProvider.

### Technical Implementations
**AI Swing Scanner**: Supports multi-timeframe charts, various SMA indicators, VWAP, pattern-specific drawing tools, and a scanner with filters for indices, candlestick patterns, chart patterns, and technical indicators. It also displays ETFs and related stocks.

**Sentinel**: Implements session-based authentication using PostgreSQL. It leverages OpenAI's `gpt-5.1` for standard trade evaluations and `gpt-5.2` for "deep evaluations," generating structured outputs including a decision gate, model tag detection, trade snapshot, logical stops/take profit analysis, risk flags, improvements, and rule adherence checklists. The Trade Evaluator ("Ivy AI") is accessible from multiple points and features a Bloomberg-style company info box, collapsible profit sections, stop presets, and context-sensitive back navigation. Evaluation results are displayed in a three-tab layout: Trade Analysis, Industry Comps (sector ETFs and peers), and News. State preservation ensures evaluation results are saved and restored on navigation. Trade submission supports dynamic ticker lookup, flexible stop/target definitions, and position sizing. API endpoints manage user authentication, trade submission, status updates, and data retrieval, with a technical data fetcher providing market context.

**System Design Choices**: The project uses a monorepo with a React frontend and an Express backend. Shared Zod schemas and Drizzle schemas ensure consistency. React Query handles server state, and Drizzle ORM provides type-safe PostgreSQL interactions.

An **AI Collective Learning** mechanism tracks rule performance across users and uses AI (gpt-4o) to suggest new rules. A **Market Sentiment Engine** gauges sentiment through various market indicators to influence AI scoring.

A robust **Trade Import System** supports multi-broker CSV imports with features like preview-before-confirm, auto-broker detection, partial fill detection, and smart orphan sell detection. Incremental Merge Promotion manages updates to existing trade cards. Orphan resolution is handled via a dedicated Orphans tab with filtering and inline editing.

**Order Levels Management** supports multiple stop loss and profit target orders per trade, displayed on trade cards with proximity alerts. An "Orders Import" tab processes Fidelity Orders CSV files.

The **Pattern Training Tool** is an interactive chart-based system for users to annotate stock setups, capturing over 40 technical indicators at key points. It includes a modular TradingChart component shared with Trading Card position views, supporting custom MA settings and a dual-chart layout. An **AI Setup Evaluation** feature scores annotated setups, provides feedback, and leverages a learning layer to analyze historical outcomes.

The **Trading Card Chart View** shows a position's ticker in a dual-chart layout with price lines for entry, exit, stop, and target. It supports refining execution times by clicking chart bars.

The **Position Splitting Rule** ensures buys/sells on the same day belong to the same position, and FIFO matching tracks P&L accurately.

The **BigIdea Indicator Data-Passing System** allows runtime data flow between indicators in a scan chain, using `provides` and `consumes` declarations. A **Scan Quality Rating** system evaluates idea scans across five dimensions (Criteria Diversity, Filter Funnel, Data Linking, Parameter Quality, Signal Coverage) providing letter grades and improvement suggestions. The **Scan Failure Funnel** returns detailed pass/fail counts for tickers at each stage of the scan.

**AI Scan Tuning** (Pro/Admin only) uses GPT-5.1 to suggest parameter adjustments based on indicator metadata, funnel data, historical learning data, and optional user instructions (e.g. "loosen scan" or "tighten criteria"), with guardrails for valid suggestions including auto-link protection, parameter bounds enforcement, and value clamping/snapping. The tuning dialog supports Apply/Undo per-suggestion, Apply All, "More Suggestions" (re-asks AI), and "Review on Chart" (closes dialog, rescans, opens chart viewer). A **Chart Rating System** allows users to rate scan results via thumbs-up/down, feeding into personalized AI scan tuning. **Preset Scan Templates** offer curated scan configurations (VCP, High Tight Flag, RS Leader, Coiling Base). A **Clear Idea** button with confirmation dialog resets the canvas to an empty state, clearing all nodes, edges, scan results, debug info, quality ratings, funnel data, selections, and panel states.

**Scan Learning Loop** (Phases 1-3 complete): Every scan run creates a `scan_sessions` record (the "spine") linking scan config, result count, result symbols, and funnel data. Chart ratings include `sessionId` and full `indicatorSnapshot` (thoughtBreakdown with per-indicator criteriaResults and diagnostics). The tuning commit flow enforces a disciplined workflow: users experiment freely (Apply/Undo/More Suggestions), then "Review on Chart" rescans and opens the chart viewer for rating. Learning is ONLY recorded on explicit user commitment via "Save & Commit Tuning" — never during experimentation. Commit requires chart review (30% rating threshold). Discarding reverts all params and records the discard as negative signal. A navigation guard prevents losing uncommitted tuning changes. The `scan_tuning_history` table stores outcome (accepted/discarded), configBefore/configAfter, acceptedSuggestions/skippedSuggestions, symbol retention (retainedUpSymbols, droppedUpSymbols, droppedDownSymbols), ratingsCount, and adminApproved status. **Phase 3 Historical Context Injection**: The AI tuning prompt now includes per-indicator learning data from past accepted/discarded sessions — param trend directions (tightened vs loosened counts), average accepted values, thumbs-up retention rates, and negative signals from discarded sessions — enabling the AI to improve suggestions across all ideas and users over time. **Admin Approval Gate**: Admin commits auto-approve; Pro user commits go to `pending_review` and appear in an admin review queue (Tuning Reviews tab) for approval/rejection before feeding into AI learning.

A **User Tier System** (standard, pro, admin) enables specific features based on user tier, including AI Scan Tuning for Pro/Admin users. Admin features include **User Management** and an **Admin-only Trader Neural Network (TNN)** for adaptive factor weighting based on trade outcomes.

## External Dependencies

### Database
- **PostgreSQL**: Primary database, managed with Drizzle ORM.

### Market Data API
- **Tiingo API** (Business tier): Provides EOD daily/weekly/monthly prices, IEX intraday data, real-time quotes, and ticker metadata.

### Fundamentals Data
- **Financial Modeling Prep (FMP) API** (free tier): Fallback fundamentals provider for sector, industry, and market cap data for tickers not in local lookup tables.

### AI Services
- **OpenAI API**: Used by Sentinel for trade evaluation with `gpt-5.1`, `gpt-5.2`, and `gpt-4o` models.

### UI/Styling
- **Google Fonts**: Inter and JetBrains Mono.
- **Lucide React**: Icon library.