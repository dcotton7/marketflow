# AI Swing Scanner

## Overview

AI Swing Scanner is a stock market scanner and analysis application that enables users to screen stocks based on technical patterns and criteria, view detailed stock charts and quotes, and manage a personal watchlist. The application fetches real-time market data from Yahoo Finance and provides an intuitive dark-themed financial dashboard interface.

## Recent Changes (February 2026)
- Replaced Candlestick Patterns section with new "Technical Indicator Signals" section
- Added 6/20 Cross signal: detects 6 SMA and 20 SMA crossover within last 3 bars
  - Cross Up/Down direction selector
  - Thumbnail shows pink 6 SMA, blue 20 SMA with green/red shaded area
  - Detail chart shows 6/20 SMA lines with thicker styling
- Added "Ride the 21 EMA" signal with configurable thresholds:
  - EMA Break Threshold (default ≤1%)
  - Pullback Threshold (default >2.5%)
  - Thumbnail shows pink 21 EMA and red 50 SMA
  - Detail chart shows thicker pink EMA 21 line
- Moved pullback patterns (5/10/20/50 DMA) from Chart Patterns into Technical Indicator Signals section
- URL params now pass technicalSignal and crossDirection to symbol page for criteria display
- Added criteria summary under "Scan Results" with [CLEAR] button to reset filters
- Indicator toggle system: clickable Shadcn Button toggles to show/hide each indicator
  - Indicator colors: SMA 5 Green (#22c55e), SMA 10 Blue (#3b82f6), SMA 50 Red (#dc2626), SMA 200 Black/White, EMA 21 Pink (#f472b6)
  - VWAPs: Auto VWAP dotted Orange, Anchored VWAP thicker Yellow
  - Pattern-specific: 3 Month SMA Pink, 12 Week VWAP (anchored to 8-month low) Yellow
- Auto-timeframe selection based on signal/pattern:
  - 6/20 Cross → 5 minute (117 bars visible = ~1.5 trading days)
  - Ride 21 EMA / Pullback → Daily
  - VCP/Weekly Tight/High Tight Flag/Cup Handle → Daily (130 bars = 6 months)
  - Monthly Tight → Monthly (24 bars = 24 months)
  - Default → Daily (200 bars = ~8-9 months)
- userSelectedInterval resets when signal/pattern changes for auto-timeframe switching

## Changes (January 2026)
- Renamed application from "TradeScan" to "AI Swing Scanner"
- Added dedicated Watchlist page with navigation in sidebar
- Implemented multi-timeframe chart selector (5m, 15m, 30m, 60m, daily, weekly, monthly)
- SMAs only display for daily/weekly/monthly timeframes (not intraday)
- Extended historical data to 2 years for proper SMA 200 coverage
- Channel lines now use blue dashed style for better visibility
- Added Market Cap, PE ratio, company description, sector info to symbol pages
- Scanner now includes index selector dropdown as first filter:
  - Dow Jones 30, Nasdaq 100, S&P 100, S&P 500, All Stocks
  - Uses getStocksByIndex() to dynamically get stock universe
- Scanner results are cached but cleared on new scan to show proper loading state
- Updated Pullback filter UI with new fields:
  - Min % Up Before Pullback (default 30%)
  - Up period was under N candles (default 10) - pbUpPeriodCandles
  - PB was between X and Y candles (default 1-5) - pbMinCandles/pbMaxCandles
- Added chart drawing tools: Toggle Channels, Price Measurement, Horizontal Lines
  - Measurement tool: Click two points to measure price change and percentage
  - Line tool: Click to place horizontal lines at price levels
  - Lines are stored as definitions and recreated on chart rebuild
- Max channel height filter only shows when VCP/Channel patterns selected
- Pattern visualization on symbol detail pages:
  - When clicking a scanner result with a chart pattern selected, pattern name is passed via URL query param
  - StockChart displays pattern-specific visualizations with toggle control
  - VCP/Weekly Tight/Monthly Tight: Blue dashed channel lines
  - High Tight Flag: Blue diagonal pole line (showing steep upward move) + green dashed flag consolidation lines at top
  - Cup and Handle: Orange parabolic curved arc at cup bottom (U-shape using 20 points) + horizontal lip line + handle channel lines
  - Pattern toggle button (with Eye icon) is on by default and controls visibility
- Daily chart timeframe now zooms to show ~200 candles (8-9 months) for better pattern visibility
  - Uses setVisibleLogicalRange instead of fitContent for daily interval
  - Other timeframes still use fitContent to show all data
- Scanner state persistence via ScannerContext:
  - Filters, results, currentPage preserved when navigating between pages
  - "Return to Results" button works correctly, doesn't reset scan
- ETF detection and holdings display:
  - When viewing ETF (SPY, QQQ, sector ETFs), shows "Top Holdings" instead of sector companies
  - Holdings include weight percentages and market cap values
  - ETF badges are clickable links to ETF symbol pages
- Related stocks improvements:
  - Pre-computed sector data with market caps (in billions)
  - Sorted by market cap descending (largest first)
  - Clickable links navigate to symbol pages
- Pattern visualization passes through URL query params when clicking scanner results

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state, caching, and data fetching
- **Styling**: Tailwind CSS with CSS variables for theming (dark financial theme)
- **Component Library**: shadcn/ui components built on Radix UI primitives
- **Charts**: TradingView Lightweight Charts (v5) for detailed candlestick charts, Recharts for mini chart snapshots
- **Build Tool**: Vite with HMR support

### Backend Architecture
- **Framework**: Express.js 5 running on Node.js
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints defined in shared route contracts (`shared/routes.ts`)
- **Data Validation**: Zod schemas for request/response validation
- **Market Data**: Yahoo Finance API (yahoo-finance2) for stock quotes, chart data, and scanner functionality
  - Uses `chart()` API method for historical data (the `historical()` method is deprecated)
  - Dynamic imports used for ESM/CJS compatibility in production builds

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts` defines tables for stock data cache, saved scans, and watchlist items
- **Migrations**: Drizzle Kit for database migrations (`drizzle-kit push`)
- **Connection**: Node-postgres (pg) with connection pooling

### Project Structure
```
├── client/           # React frontend
│   └── src/
│       ├── components/   # UI components including shadcn/ui
│       ├── hooks/        # React Query hooks for API calls
│       ├── pages/        # Route components (Scanner, Symbol)
│       └── lib/          # Utilities and query client
├── server/           # Express backend
│   ├── routes.ts     # API route handlers
│   ├── storage.ts    # Database operations layer
│   └── db.ts         # Database connection management
├── shared/           # Shared code between client/server
│   ├── schema.ts     # Drizzle table definitions
│   └── routes.ts     # API contract definitions with Zod
└── migrations/       # Database migrations
```

### API Endpoints
- `GET /api/stocks/:symbol/history` - Historical OHLCV data
- `GET /api/stocks/:symbol/quote` - Real-time quote data
- `POST /api/scanner/run` - Run stock scanner with filters (candlestickPattern, chartPattern, patternStrictness, smaFilter, priceWithin50dPct)
- `GET /api/watchlist` - Get user's watchlist
- `POST /api/watchlist` - Add symbol to watchlist
- `DELETE /api/watchlist/:id` - Remove from watchlist

### Build System
- Development: Vite dev server with Express middleware
- Production: ESBuild bundles server, Vite builds client to `dist/`
- Scripts: `npm run dev` (development), `npm run build` (production build), `npm run db:push` (sync schema)

## External Dependencies

### Database
- **PostgreSQL**: Primary database, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries and schema management

### Market Data API
- **Yahoo Finance (yahoo-finance2)**: Provides stock quotes, historical data, and company information. No API key required but subject to rate limits.

### UI/Styling
- **Google Fonts**: Inter (sans-serif) and JetBrains Mono (monospace) font families
- **Lucide React**: Icon library

### Development Tools
- **Replit Plugins**: Cartographer, dev banner, and runtime error overlay for Replit environment integration