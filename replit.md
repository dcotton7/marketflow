# TradeScan

## Overview

TradeScan is a stock market scanner and analysis application that enables users to screen stocks based on technical patterns and criteria, view detailed stock charts and quotes, and manage a personal watchlist. The application fetches real-time market data from Yahoo Finance and provides an intuitive dark-themed financial dashboard interface.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state, caching, and data fetching
- **Styling**: Tailwind CSS with CSS variables for theming (dark financial theme)
- **Component Library**: shadcn/ui components built on Radix UI primitives
- **Charts**: Recharts for stock data visualization
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
- `POST /api/scanner/run` - Run stock scanner with filters (candlestickPattern, chartPattern, patternStrictness)
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