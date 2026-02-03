# AI Swing Scanner & Sentinel

## Overview

This project consists of two distinct applications:

**AI Swing Scanner**: A stock market scanning and analysis tool designed for identifying technical patterns and criteria. It offers detailed stock charts, real-time quotes, and a personal watchlist, all powered by Yahoo Finance data within a dark-themed financial dashboard. The application provides advanced charting capabilities including various SMAs, VWAP, and visualizations for patterns like Cup and Handle, VCP, and High Tight Flag.

**Sentinel**: A multi-user web application for evaluating trade ideas and building trading discipline. It utilizes OpenAI's advanced models (gpt-5.1, gpt-5.2) to assess user-submitted trade ideas, highlight potential risks, and provide judgment before execution. Key features include:
- Session-based authentication with PostgreSQL-backed sessions
- Trade lifecycle tracking (Considering → Active → Closed)
- **Personal Trading Rules**: Define and track adherence to custom rules
- **Watchlist Management**: Monitor setups with target entry prices and priority levels
- **Trade Close Flow**: Record exit prices, outcomes (win/loss/breakeven), and rule adherence
- **Contextual AI Evaluation**: AI considers current positions, watchlist, and personal rules when evaluating
- Detailed event logging and evaluation history

Sentinel is strictly an evaluation tool focused on rewarding good process and discipline - it does not generate trade signals.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The application features a dark-themed financial dashboard. The AI Swing Scanner offers a dual-chart layout: a fixed daily chart with specific SMAs and a variable timeframe chart allowing user interaction and tool usage. Charting includes specialized visualizations for patterns like Cup and Handle (MarketSurge style), VCP, and High Tight Flag, using distinct color schemes for clarity (e.g., bright blue for Cup and Handle elements). Timeframe selection is persistent across navigation. Sentinel features a clear dashboard with tabs for trade status and an evaluation form with async ticker lookup and detailed input options for stop prices and profit targets.

### Technical Implementations
**AI Swing Scanner**:
- Features include a multi-timeframe chart selector (5m, 15m, 30m, 60m, daily, weekly, monthly) with auto-selection based on the active signal/pattern.
- SMA indicators (5, 21, 50, 200) are displayed based on timeframe, along with VWAP and other pattern-specific lines.
- Scanner allows filtering by index (Dow Jones 30, Nasdaq 100, S&P 100, S&P 500, All Stocks), candlestick patterns, chart patterns, and technical indicators (e.g., 6/20 Cross, Ride the 21 EMA).
- Drawing tools like channels, price measurement, and horizontal lines are available on charts.
- ETF holdings and related stocks are displayed with clickable links.

**Sentinel**:
- Implements session-based authentication using PostgreSQL-backed sessions (`connect-pg-simple`).
- Leverages OpenAI's `gpt-5.1` for default trade evaluation and `gpt-5.2` for "deep eval."
- **Enhanced Response Shape (v3.0)** with structured evaluation output:
  - Decision Gate: Status (GREEN/YELLOW/RED), Score (0-100), Confidence (HIGH/MEDIUM/LOW)
  - Model Tag Detection: BREAKOUT, RECLAIM, CUP_AND_HANDLE, PULLBACK, EPISODIC_PIVOT, UNKNOWN
  - Plan Summary: Entry, stop, risk per share, target, R:R ratio
  - "Why This Could Work" bullets (3-7 reasons tied to rules)
  - Risk Flags with severity (high/medium/low) and detailed descriptions
  - "What Would Make This Better" improvements (2-3 concrete changes)
  - Rule Checklist showing which rules are followed/violated
- Trade submission forms include dynamic ticker lookup, flexible stop price and target definitions (e.g., LOD, DMA, RR multipliers), and position sizing in shares or dollars.
- Commitment Prompt with 4 action buttons: Commit Trade, Modify/Wait, Add to Watchlist, Reject/Pass
- API endpoints support user authentication, trade submission, status updates, and retrieval of trade details and evaluations.
- Technical data fetcher provides real-time LOD, 5-day range, key MAs (5/10/21/50/200), and ATR for AI evaluation context.

### System Design Choices
The project utilizes a monorepo structure, separating client (React frontend) and server (Express backend) code while sharing common definitions (Zod schemas for API contracts, Drizzle schemas for database). React Query manages server state and caching for efficient data fetching on the frontend. Drizzle ORM provides type-safe database interactions with PostgreSQL, ensuring robust data management and migrations.

### Data Storage
- **AI Swing Scanner**: Stores stock data cache, saved scans, and watchlist items.
- **Sentinel**: Manages multiple tables:
  - `sentinel_users`: User accounts with secure password hashing
  - `sentinel_trades`: Trade records with full lifecycle (entry, exit, P&L, outcome, rules followed)
  - `sentinel_evaluations`: AI evaluation history per trade
  - `sentinel_events`: Detailed event logging (status changes, stop/target updates)
  - `sentinel_watchlist`: Setups being monitored with target entry, stop plan, priority
  - `sentinel_rules`: User's custom trading rules/rubric for discipline tracking (61 starter rules across 12 categories)
  - `sentinel_rule_suggestions`: AI-generated rule suggestions with confidence scores and adoption tracking
  - `sentinel_rule_performance`: Aggregated rule performance statistics for collective learning

### Rule Categories (12 total)
structural (formerly auto_reject), entry, exit, profit_taking, stop_loss, ma_structure, base_quality, breakout, position_sizing, market_regime, risk, general

**Note**: "auto_reject" is internally retained as the database value but displayed as "Structural" or "Structural Requirements" in the UI. Similarly, severity level "auto_reject" displays as "Structural Issue" to use guidance-oriented language.

### AI Collective Learning
- Rules have sources: 'starter' (61 pre-loaded), 'user' (custom), 'ai_collective' (learned from patterns), 'ai_agentic' (future agent-generated)
- Rule performance is tracked across all users (anonymized) via `getHighDataRules(5)` which only analyzes rules with 5+ trades
- AI endpoint uses gpt-4o to analyze patterns and suggest new rules with confidence scores
- Users can adopt suggestions into their personal rulebook via the AI Insights dashboard tab

### Market Sentiment Engine
- **Weekly Trend**: SPY vs 40-week MA with slope analysis → Tailwind/Neutral/Headwind
- **Daily Risk Basket**: QQQ, IWO, SLY, ARKK, VIX with 20-day MA → RISK-ON/MIXED/RISK-OFF
- **Sector Trend**: SPDR sector ETFs (XLK, XLF, XLE, etc.) with 50/200-day MA analysis
- **Choppiness Index**: SPY daily (14-period) and weekly (10-period) calculations
  - Thresholds: >61.8 = CHOPPY, <38.2 = TRENDING
  - Regime influences AI scoring: penalizes choppy conditions (-5 daily, -10 weekly)
  - Displayed in header UI with color-coded regime status
- Canary/Early-Warning Tags: Narrow Leadership, Speculative Rebound Attempt, Volatility Stress
- 30-minute cache with timestamp display ("Updated Xm ago")
- Sentiment feeds into AI trade evaluation: adjusts scoring for LONG vs SHORT based on environment
- Sentiment displayed in page header (weekly + daily + choppiness) and ticker box (sector trend)

### Trade Labels & Admin System
- **Admin Users**: `isAdmin` column on sentinel_users enables special permissions
- **Trade Labels**: Categorize/tag trades with custom colored labels
  - `sentinel_trade_labels`: Label definitions with name, color, description
  - `sentinel_trade_to_labels`: Many-to-many association between trades and labels
  - Admin-only labels: Labels with `isAdminOnly=true` are only visible to admin users
- **Label Selection**: Available on the trade evaluation form when committing trades
- **Label Filtering**: Clickable label filter grid on dashboard to filter trades by label
- Labels are displayed on trade cards in the dashboard

## External Dependencies

### Database
- **PostgreSQL**: Primary database for both applications, managed with Drizzle ORM.

### Market Data API
- **Yahoo Finance (yahoo-finance2)**: Used by AI Swing Scanner for real-time quotes, historical data, and company information.

### AI Services
- **OpenAI API**: Utilized by Sentinel for advanced trade idea evaluation using `gpt-5.1` and `gpt-5.2` models.

### UI/Styling
- **Google Fonts**: Inter and JetBrains Mono for typography.
- **Lucide React**: Icon library for UI elements.

### Development Tools
- **Replit Plugins**: Cartographer, dev banner, and runtime error overlay for Replit environment integration.