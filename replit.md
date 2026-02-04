# AI Swing Scanner & Sentinel

## Overview
This project comprises two applications: **AI Swing Scanner**, a stock market analysis tool for identifying technical patterns with detailed charts and real-time data, and **Sentinel**, a multi-user web application that uses advanced AI (OpenAI's gpt-5.1/5.2) to evaluate user-submitted trade ideas, enforce trading discipline, and track trade performance against personal rules. Sentinel focuses on process-driven improvement rather than signal generation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
Both applications feature a dark-themed financial dashboard. The AI Swing Scanner offers a dual-chart layout with fixed and variable timeframes, specialized pattern visualizations (Cup and Handle, VCP, High Tight Flag) using distinct color schemes, and persistent timeframe selection. Sentinel provides a clear dashboard with trade status tabs, an evaluation form with async ticker lookup, and detailed input for trade parameters.

### Technical Implementations
**AI Swing Scanner**: Includes multi-timeframe charts, various SMA indicators, VWAP, pattern-specific lines, and a scanner with filters for indices, candlestick patterns, chart patterns, and technical indicators. Drawing tools and ETF/related stock displays are integrated.

**Sentinel**: Features session-based authentication using `connect-pg-simple` and PostgreSQL. It uses OpenAI's `gpt-5.1` for default evaluations and `gpt-5.2` for "deep eval," providing structured evaluation outputs including a decision gate (status, score, confidence), model tag detection, plan summary, "Why This Could Work" points, risk flags, and rule adherence checklists. Trade submission forms support dynamic ticker lookup, flexible stop/target definitions, and position sizing. API endpoints manage user authentication, trade submission, status updates, and data retrieval. A technical data fetcher provides real-time market data for AI evaluation context.

### System Design Choices
The project adopts a monorepo structure, separating a React frontend and an Express backend, sharing common definitions like Zod schemas for API contracts and Drizzle schemas for the database. React Query manages server state and caching. Drizzle ORM ensures type-safe PostgreSQL interactions.

### Data Storage
**AI Swing Scanner**: Stores stock data cache, saved scans, and watchlist items.
**Sentinel**: Manages user accounts, trade records, AI evaluation history, event logs, watchlists, user-defined trading rules, AI-generated rule suggestions, and rule performance statistics.

### AI Collective Learning
Rules are sourced from 'starter', 'user', 'ai_collective', and 'ai_agentic'. Rule performance is tracked across users, and an AI endpoint (gpt-4o) analyzes patterns to suggest new rules.

### Market Sentiment Engine
Detects market sentiment through weekly/daily trends (SPY vs MAs), risk baskets (QQQ, IWO, SLY, ARKK, VIX), sector trends, and Choppiness Index. Sentiment influences AI scoring and is displayed in the UI.

### Trade Labels & Admin System
Supports custom, colored trade labels for categorization and filtering. Admin users have elevated permissions, including creating admin-only labels.

### Trade Source Filtering
Tracks trade sources ('hand' or 'import') and `importBatchId`. Allows filtering trades by source and provides functionality to delete trades by source.

### Interactive AI Suggestions
An auto-suggest endpoint provides stop, target, and position size suggestions based on technical data, ranked by confidence and relevance. Suggestions are integrated into the UI.

### Trade Import System
A multi-broker CSV import system (Fidelity, Schwab, Robinhood) allows importing historical trades. Features include preview-before-confirm, auto-broker detection, partial fill detection, transaction-wrapped batch inserts, and smart orphan sell detection with a review flow. Orphan detection now respects per-account position tracking for both imported and hand-entered trades.

### Import Review & Orphan Management
Orphan sells (sells without matching buys) are tracked with statuses: 'pending', 'muted', 'resolved'. The review pane shows ALL orphans needing cost basis (pending + muted) with toggle-style mute buttons that switch between pending/muted states. Muted orphans are hidden from Trading Cards but remain visible in review. Bulk MUTE ALL/DELETE ALL actions are available. Default purchase date is derived from the last BUY trade for the same ticker:account in the batch. Promoting to Trading Cards is blocked until all pending orphans are addressed. Orphan counts are dynamically calculated from the database to stay in sync.

### Account Selection for Trades
Hand-entered trades support account selection via a dropdown that shows the user's configured accounts. The first account is auto-selected as default, and selection persists between entries. Backend validates accountName against user's account settings, silently ignoring invalid account names.

### Trader Neural Network (TNN)
An admin-only, three-layer adaptive factor weighting system where AI learns from trade outcomes. It adjusts weights for discipline factors (rule categories), setup type factors (patterns), and contextual modifiers (setup × market conditions). Weights are fetched during AI evaluation, and AI suggestions for weight changes require admin approval.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for both applications, managed with Drizzle ORM.

### Market Data API
- **Yahoo Finance (yahoo-finance2)**: Used by AI Swing Scanner for market data.

### AI Services
- **OpenAI API**: Utilized by Sentinel for trade evaluation using `gpt-5.1` and `gpt-5.2` models.

### UI/Styling
- **Google Fonts**: Inter and JetBrains Mono.
- **Lucide React**: Icon library.