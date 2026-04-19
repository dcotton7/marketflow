# Current Priorities

Keep these three projects prominent in planning and backlog reviews:

1. Alerts System
2. Workspace systems
3. Tightening of the admin and role-based system

## Backlog (tracked work)

| Item | Notes |
|------|--------|
| **Shared intraday bar cache (table- or Redis-backed)** | Today `getIntradayBars` uses a per-process in-memory `Map`; only that Node instance benefits. Move to Postgres (durable, indexed by symbol+interval+time) or Redis (shared hot cache) so all users and all app instances reuse warmed history; keep tail refresh + snapshot merge for the live bar. Define retention vs chart lookback, upsert strategy, and pruning. Supports workspace/chart experience; optional tie-in to alerts if intraday data is reused there. |
| **Token allowance + usage (per role / tier)** | Ship fields `tokensAllowed` and `tokensUsed` (or equivalent) on user/session context from `/api/auth/me` (or sibling). **For now: every tier unlimited** (`tokensUsed` can stay 0 until metering exists). Later: cap by tier and increment on metered calls (AI, analysis, etc.). |

## Tier & RBAC build checklist (draft)

Supports priority **3** (admin + role-based system).

1. Tiers in DB: `free | standard | professional | pro_plus` + `is_admin`.
2. Single feature matrix (config or table): booleans per screen + **alert cap** per tier.
3. `/api/auth/me`: return `tier`, `isAdmin`, `features`, `maxAlerts`, **`tokensAllowed`**, **`tokensUsed`** (unlimited = high cap or `null` meaning no limit).
4. Server guards on gated routes (403 if missing feature); never UI-only.
5. Alerts: enforce `maxAlerts` on create/enable.
6. Client nav: hide/disable from `features`.
7. Deep links: blocked route → short “not on your plan” or redirect.
8. `/sentinel/admin/*` + Patterns: `isAdmin` only.
9. Admin user screen: set tier + admin flag.
10. Migration backfill for existing users.
11. Smoke: one gated API per tier; one over-cap alert; one token field present in payload.
12. Keep the access matrix screenshot/table in docs so product and code match.

## Notes

- Default assumption: new settings and workflows are user-level unless explicitly marked admin-level.
- Use these priorities as a lens when sequencing follow-up work.
- If a new task supports one of these directly, call that out clearly in planning.
