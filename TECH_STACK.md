# Tech Stack — AI Swing Scanner & Sentinel

Last updated: February 15, 2026

---

## Frontend (User Interface)

| Technology | Role |
|---|---|
| **React** | Renders the entire UI — pages, components, charts, forms, dialogs |
| **TypeScript** | Programming language for the full codebase; catches type errors before runtime |
| **Vite** | Bundles and serves frontend code; provides fast hot-reload during development |
| **Tailwind CSS** | Utility-first CSS framework; handles all styling, spacing, layout, dark theme |
| **shadcn/ui** | Pre-built UI primitives (Button, Card, Dialog, Sidebar, Form, Badge, etc.) built on Radix UI and styled with Tailwind |
| **Wouter** | Lightweight client-side router for page navigation |
| **TanStack React Query v5** | Server state management — data fetching, caching, background refresh, optimistic updates |
| **React Hook Form** | Form state management with field-level validation |
| **Zod** | Schema validation library; used with React Hook Form via `@hookform/resolvers/zod` |
| **Lightweight Charts (TradingView)** | Renders interactive candlestick/volume charts with overlays, price lines, and drawing tools |
| **React Flow** | Powers the drag-and-drop indicator node canvas in BigIdea Scanner |
| **Lucide React** | Icon library used throughout the UI |
| **Google Fonts** | Inter (UI text) and JetBrains Mono (ticker/code display) |

---

## Backend (Server)

| Technology | Role |
|---|---|
| **Express.js** | Web server — handles all API routes, serves the frontend, manages middleware |
| **TypeScript** | Same language as frontend; shared types eliminate mismatches |
| **Drizzle ORM** | Type-safe PostgreSQL query builder and schema manager |
| **Drizzle-Zod** | Auto-generates Zod validation schemas from Drizzle table definitions |
| **express-session** | Session middleware — keeps users logged in across requests |
| **Passport.js** | Authentication framework — login, registration, password hashing with scrypt |
| **connect-pg-simple** | Stores sessions in PostgreSQL instead of memory (survives server restarts) |

---

## Database

| Technology | Role |
|---|---|
| **PostgreSQL** | Primary data store for all persistent data — users, trades, scan sessions, watchlists, tuning history, rules, evaluations, pattern annotations, order levels (hosted via Replit's built-in database) |
| **Drizzle Kit** | Schema migration tool — syncs TypeScript schema definitions to the live database via `db:push` |

---

## AI Services

| Model | Role |
|---|---|
| **OpenAI GPT-5.1** | Standard trade evaluations in Sentinel ("Ivy AI" analysis — decision gate, risk flags, trade snapshots) |
| **OpenAI GPT-5.2** | Deep evaluations — more thorough multi-factor trade analysis |
| **OpenAI GPT-4o** | Collective learning rule suggestions, AI scan tuning parameter recommendations, setup evaluations in Pattern Training |

All AI calls go through the OpenAI API. The API key is stored as an encrypted secret.

---

## External Data APIs

| Service | Tier | Role |
|---|---|---|
| **Tiingo API** | Business | All stock price data — EOD daily/weekly/monthly history, IEX intraday data, real-time quotes, ticker metadata |
| **Financial Modeling Prep (FMP)** | Free | Fallback fundamentals provider — sector, industry, market cap for tickers not in local lookup tables |

---

## Shared Layer

| Technology | Role |
|---|---|
| **`shared/schema.ts`** | Single source of truth for all database table definitions, insert schemas, and TypeScript types used by both frontend and backend |
| **Zod schemas** | Validate data at API boundaries — request bodies, form inputs, AI responses |

---

## Infrastructure & Tooling

| Technology | Role |
|---|---|
| **Replit** | Hosting platform — development environment, PostgreSQL database, deployment/publishing, secret management |
| **Nix** | System-level package manager — provides Node.js runtime and system dependencies |
| **npm** | JavaScript package manager for all project dependencies |

---

## AI Coding Agent

| Detail | Value |
|---|---|
| **Agent** | Replit Agent |
| **Powered by** | Large language model (LLM) |
| **What it does** | Writes, edits, and debugs all code in the project; manages database schemas; runs the app; tests features; searches documentation; installs packages |
| **How it works** | Reads files for context, makes targeted edits, runs shell commands, queries databases, fetches logs, and runs end-to-end tests to verify changes |
| **Cost note** | The most resource-intensive part of development — every file read, edit, command execution, and reasoning step consumes compute credits |
| **Best practices for cost** | Give specific requests, batch related changes together, avoid unnecessary broad refactors |

---

## Architecture Summary

```
Browser (React + Vite)
    │
    ├── React Query ──→ Express API ──→ PostgreSQL
    │                       │
    │                       ├── OpenAI API (trade evals, scan tuning, learning)
    │                       ├── Tiingo API (price data, quotes)
    │                       └── FMP API (fundamentals fallback)
    │
    ├── React Flow (scan canvas)
    ├── Lightweight Charts (stock charts)
    └── Tailwind + shadcn/ui (styling)
```

All code is TypeScript. Shared Zod/Drizzle schemas enforce type safety across the entire stack.
