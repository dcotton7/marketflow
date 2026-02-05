# AI Swing Scanner & Sentinel

## Overview
This project comprises two applications: **AI Swing Scanner**, a stock market analysis tool for identifying technical patterns with detailed charts and real-time data, and **Sentinel**, a multi-user web application that uses advanced AI (OpenAI's gpt-5.1/5.2) to evaluate user-submitted trade ideas, enforce trading discipline, and track trade performance against personal rules. Sentinel focuses on process-driven improvement rather than signal generation.

## User Preferences
Preferred communication style: Simple, everyday language.
Preferred test username: Foreboding

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
Tracks trade sources ('hand' or 'import') and `importBatchId`. Allows filtering trades by source and provides functionality to delete trades by source. Import batches have a customizable `importName` field that defaults to "FILE" + last 4 characters of the filename, which can be renamed in Import History.

### Dashboard UI Enhancements
The dashboard features an enhanced layout with:
- **Summary Section**: Four cards showing Open PnL, Realized Gain/Loss, Active Positions count, and Closed Trades count with color-coded values (green positive, red negative).
- **Advanced Filtering**: Unified filter bar with Month dropdown, Year dropdown, Account dropdown, Source multi-select buttons, and Tags multi-select buttons. Account filter allows viewing trades from a specific brokerage account (4015, 1094, etc.) regardless of which import file they came from. Sources use OR logic (show trades from ANY selected source since a trade only has one source). Tags use AND logic (must have ALL selected tags). All filter selections persist to localStorage.
- **Active/Closed Tabs**: Separate tabs for Active (open positions with unrealized P&L) and Closed (completed trades with realized P&L) trades.
- **Source Display**: Each trade card displays its source as a small indicator - showing the import name for imported trades or "Hand Entered" for manual entries.

### Interactive AI Suggestions
An auto-suggest endpoint provides stop, target, and position size suggestions based on technical data, ranked by confidence and relevance. Suggestions are integrated into the UI.

### Trade Import System
A multi-broker CSV import system (Fidelity, Schwab, Robinhood) allows importing historical trades. Features include preview-before-confirm, auto-broker detection, partial fill detection, transaction-wrapped batch inserts, and smart orphan sell detection with a review flow. Orphan detection now respects per-account position tracking for both imported and hand-entered trades.

**Incremental Import Merge Logic**: When promoting imported trades to Trading Cards, the system merges lot entries into existing cards by ticker+account key instead of creating duplicates. Key behaviors:
- New lots are appended to existing active cards for the same ticker+account
- Duplicate lots (same ID) are filtered out to prevent duplication
- FIFO matching recalculates position metrics after merge
- Auto-close: Positions with abs(position_size) < 0.01 are automatically marked as closed
- Cost basis calculation:
  - Open positions: weighted average of remaining open lots only
  - Closed positions: historical weighted average entry price

**Cleanup Duplicates Utility**: Endpoint `/api/sentinel/import/cleanup-duplicates` merges duplicate active cards (same ticker+account) into one, combining all lot entries with FIFO recalculation and cascade-deleting related evaluations/events/labels for removed duplicates.

### Import Review & Orphan Management
Orphan sells (sells without matching buys) are tracked with statuses: 'pending', 'muted', 'resolved'. The review pane shows ALL orphans needing cost basis (pending + muted) with toggle-style mute buttons that switch between pending/muted states. Muted orphans are hidden from Trading Cards but remain visible in review. Bulk MUTE ALL/DELETE ALL actions are available. Default purchase date is derived from the last BUY trade for the same ticker:account in the batch. Promoting to Trading Cards is blocked until all pending orphans are addressed. Orphan counts are dynamically calculated from the database to stay in sync. When unmuting an orphan, visual feedback is provided with a green highlight that fades after 3 seconds.

### Duplicate Detection & Resolution
Duplicate detection runs **automatically after import confirmation** and must be resolved **before** orphan review. The workflow order is: Import → Duplicate Review (Step 1) → Orphan Review (Step 2) → Promote to Trading Cards.

Duplicates match existing Trading Cards or previous imports by ticker, date, price, and quantity. Users can review duplicates with two resolution options:
- **Delete**: Remove the import row and keep existing data unchanged
- **Overwrite**: Update existing records with new import data

Bulk actions (Delete All / Overwrite All) are available. Promotion is blocked until all duplicates are resolved. Batch cards show duplicates as "Step 1" with Review Orphans button disabled until duplicates are cleared.

### Account Selection for Trades
Hand-entered trades support account selection via a dropdown that shows the user's configured accounts. The first account is auto-selected as default, and selection persists between entries. Backend validates accountName against user's account settings, silently ignoring invalid account names.

### Trader Neural Network (TNN)
An admin-only, three-layer adaptive factor weighting system where AI learns from trade outcomes. It adjusts weights for discipline factors (rule categories), setup type factors (patterns), and contextual modifiers (setup × market conditions). Weights are fetched during AI evaluation, and AI suggestions for weight changes require admin approval.

### System Settings
Per-user display customization stored in `sentinel_system_settings` table. Settings include:
- **Overlay Color**: Theme overlay color (default: #1e3a5f)
- **Overlay Transparency**: Overlay opacity 0-100% (default: 75%)
- **Background Color**: Page background color (default: #0f172a)
- **Logo Transparency**: Watermark logo opacity 0-100% (default: 6%)

Settings are managed via SystemSettingsProvider context and applied across all Sentinel pages. Access settings via Admin → Settings tab.

### User Management (Admin)
Admin-only user management tab under Admin page:
- Lists all users with rule counts (starter rules, custom rules)
- Shows "Needs Seeding" indicator for users without starter rules
- "Seed Rules" button to provision starter rules for users who don't have them
- Endpoints: `GET /api/sentinel/admin/users`, `POST /api/sentinel/admin/seed-rules/:userId`

### TickerWidget Display
The Bloomberg-style ticker widget on trade cards displays:
- Current price with market % change
- Direction indicator (LONG/SHORT/WATCH)
- Position P&L (unrealized gain/loss)
- **Position Shares**: Shows number of shares held (from FIFO totalRemaining or positionSize fallback) in format "X shs"

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