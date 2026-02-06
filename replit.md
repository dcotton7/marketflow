# AI Swing Scanner & Sentinel

## Overview
This project consists of two core applications: **AI Swing Scanner** and **Sentinel**. The **AI Swing Scanner** is a stock market analysis tool designed to identify technical patterns and provide real-time data with detailed charts. **Sentinel** is a multi-user web application leveraging advanced AI (OpenAI's gpt-5.1/5.2) to evaluate user-submitted trade ideas, enforce trading discipline through personal rules, and track performance. Sentinel's primary focus is on process improvement in trading rather than generating trade signals. The overarching vision is to provide comprehensive tools for traders to analyze markets, refine their strategies, and improve discipline, ultimately enhancing their trading performance and fostering continuous learning.

## User Preferences
Preferred communication style: Simple, everyday language.
Preferred test username: Foreboding

## System Architecture

### UI/UX Decisions
Both applications feature a dark-themed financial dashboard. The AI Swing Scanner presents a dual-chart layout with fixed and variable timeframes, visualizing specific patterns (Cup and Handle, VCP, High Tight Flag) using distinct color schemes. Sentinel offers a clean dashboard with trade status tabs, an asynchronous ticker lookup in its evaluation form, and comprehensive input fields for trade parameters. Customization options include overlay color, transparency, background color, and logo transparency, managed via a SystemSettingsProvider.

### Technical Implementations
**AI Swing Scanner**: Features multi-timeframe charts, various SMA indicators, VWAP, pattern-specific drawing tools, and a scanner with filters for indices, candlestick patterns, chart patterns, and technical indicators. It also displays ETFs and related stocks.

**Sentinel**: Implements session-based authentication using PostgreSQL. It uses OpenAI's `gpt-5.1` for standard trade evaluations and `gpt-5.2` for "deep evaluations," generating structured outputs that include a decision gate (status, score, confidence), model tag detection, plan summary, "Why This Could Work" points, risk flags, and rule adherence checklists. Trade submission supports dynamic ticker lookup, flexible stop/target definitions, and position sizing. API endpoints manage user authentication, trade submission, status updates, and data retrieval, with a technical data fetcher providing market context for AI evaluations.

### System Design Choices
The project utilizes a monorepo structure, separating a React frontend from an Express backend. Shared definitions, such as Zod schemas for API contracts and Drizzle schemas for the database, ensure consistency. React Query manages server state and caching, while Drizzle ORM provides type-safe PostgreSQL interactions.

The system incorporates an **AI Collective Learning** mechanism where trading rules are sourced from 'starter', 'user', 'ai_collective', and 'ai_agentic' categories. Rule performance is tracked across users, and an AI endpoint (gpt-4o) analyzes patterns to suggest new rules. A **Market Sentiment Engine** gauges sentiment through trends in major indices, risk baskets, sector trends, and the Choppiness Index, influencing AI scoring and displayed in the UI.

A robust **Trade Import System** supports multi-broker CSV imports (e.g., Fidelity, Schwab, Robinhood) with features like preview-before-confirm, auto-broker detection, partial fill detection, and smart orphan sell detection with a review flow. Incremental import merge logic ensures that new lots are appended to existing active trade cards by ticker+account key, preventing duplicates and recalculating FIFO matching and cost basis. Orphan resolution is managed through per-batch and global dialogs, with the ability to load cost basis from CSVs and handle "synthetic dates" for missing purchase dates. Duplicate detection and resolution are integrated into the import workflow, requiring resolution before trade promotion.

**Order Levels Management** supports multiple stop loss and profit target orders per trade, displayed on trade cards with proximity alerts. Expandable mini-grids allow inline adding and deleting of order levels, and a system-derived partial profit level is shown. An "Orders Import" tab processes Fidelity Orders CSV files, parsing and importing stop loss/limit orders with duplicate detection and filtering of irrelevant order statuses.

The **Pattern Training Tool** is an interactive chart-based system for users to annotate stock setups, building a personal pattern library. Users mark key points on charts (Entry, Stop, Target, Support/Resistance, Breakout/Breakdown), and the system captures over 40 technical indicators at each point. This tool includes an engine for data fetching and indicator calculation, a lightweight-charts based UI, and database storage for setups and points.

Admin features include **User Management**, allowing administrators to list users, track rule counts, and provision starter rules, and an **Admin-only Trader Neural Network (TNN)**, a three-layer adaptive factor weighting system where AI learns from trade outcomes to adjust weights for discipline factors, setup types, and contextual modifiers.

## External Dependencies

### Database
- **PostgreSQL**: Primary database, managed with Drizzle ORM.

### Market Data API
- **Yahoo Finance (yahoo-finance2)**: Used for fetching market data.

### AI Services
- **OpenAI API**: Used by Sentinel for trade evaluation with `gpt-5.1`, `gpt-5.2`, and `gpt-4o` models.

### UI/Styling
- **Google Fonts**: Inter and JetBrains Mono.
- **Lucide React**: Icon library.